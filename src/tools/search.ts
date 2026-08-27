import { z } from "zod";
import { promises as fs, existsSync } from "node:fs";
import * as path from "node:path";
import { spawn } from "node:child_process";
import type { Workspace } from "./fs.js";

const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "build", "out", ".next", ".venv", "venv",
  "__pycache__", ".cache", "target", ".idea", ".vscode",
]);

const TEXT_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".md", ".txt", ".py",
  ".go", ".rs", ".java", ".kt", ".rb", ".php", ".c", ".h", ".cpp", ".hpp",
  ".cs", ".swift", ".yml", ".yaml", ".toml", ".ini", ".cfg", ".sh", ".bat",
  ".ps1", ".sql", ".html", ".css", ".scss", ".vue", ".svelte", ".xml", ".env",
]);

const MAX_FILE_SIZE = 1024 * 1024;
const DEFAULT_MAX_MATCHES = 200;

interface Match {
  file: string;
  line: number;
  text: string;
}

let cachedRgPath: string | null | undefined = undefined;

async function getRipgrepPath(): Promise<string | null> {
  if (cachedRgPath !== undefined) return cachedRgPath;

  try {
    // Check for vendored @vscode/ripgrep binary
    const rgPkg = await import("@vscode/ripgrep" as any).catch(() => null);
    if (rgPkg?.rgPath && existsSync(rgPkg.rgPath)) {
      cachedRgPath = rgPkg.rgPath as string;
      return cachedRgPath;
    }
  } catch {
    // Ignore dynamic import failure
  }

  // Check system PATH
  cachedRgPath = await new Promise<string | null>((resolve) => {
    const child = spawn("rg", ["--version"]);
    child.on("error", () => resolve(null));
    child.on("close", (code) => resolve(code === 0 ? "rg" : null));
  });

  return cachedRgPath;
}

export function grepTool(ws: Workspace) {
  return {
    name: "grep",
    description:
      "Search file contents using fast ripgrep (with fallback to internal walker). Returns matching lines as file:line:text.",
    parameters: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Regular expression pattern" },
        path: { type: "string", description: "Directory to search (default: workspace root)" },
        include: {
          type: "string",
          description: 'Optional glob filter for filenames, e.g. "*.ts"',
        },
        case_insensitive: { type: "boolean", description: "Case-insensitive search (default false)" },
        multiline: { type: "boolean", description: "Enable multiline matching (default false)" },
        head_limit: { type: "number", description: "Max matches to return (default 200, max 1000)" },
        offset: { type: "number", description: "Skip first N matches (default 0)" },
      },
      required: ["pattern"],
    },
    schema: z.object({
      pattern: z.string().min(1),
      path: z.string().optional(),
      include: z.string().optional(),
      case_insensitive: z.boolean().optional().default(false),
      multiline: z.boolean().optional().default(false),
      head_limit: z.number().int().min(1).max(1000).optional().default(DEFAULT_MAX_MATCHES),
      offset: z.number().int().min(0).optional().default(0),
    }),
    async execute(args: {
      pattern: string;
      path?: string;
      include?: string;
      case_insensitive?: boolean;
      multiline?: boolean;
      head_limit?: number;
      offset?: number;
    }): Promise<string> {
      const limit = args.head_limit ?? DEFAULT_MAX_MATCHES;
      const offset = args.offset ?? 0;
      const rootAbs = ws.resolve(args.path ?? ".");

      const rgExecutable = await getRipgrepPath();
      if (rgExecutable) {
        try {
          return await executeRipgrep(ws, rgExecutable, rootAbs, args, limit, offset);
        } catch {
          // If native ripgrep execution fails (e.g. unsupported regex flavor), fall back cleanly
        }
      }

      return await executeJsGrep(ws, rootAbs, args, limit, offset);
    },
  };
}

async function executeRipgrep(
  ws: Workspace,
  rgPath: string,
  rootAbs: string,
  args: {
    pattern: string;
    include?: string;
    case_insensitive?: boolean;
    multiline?: boolean;
  },
  limit: number,
  offset: number
): Promise<string> {
  const rgArgs = [
    "--color=never",
    "--no-heading",
    "--line-number",
    "--with-filename",
    args.case_insensitive ? "-i" : "-s",
    ...(args.multiline ? ["-U", "--multiline-dotall"] : []),
    ...(args.include ? ["-g", args.include] : []),
    "--max-count", String(limit + offset),
    "--",
    args.pattern,
    rootAbs,
  ];

  return new Promise((resolve, reject) => {
    const child = spawn(rgPath, rgArgs, {
      cwd: ws.root,
      env: { ...process.env, NO_COLOR: "1" },
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (d: Buffer) => {
      stdout += d.toString();
    });

    child.stderr.on("data", (d: Buffer) => {
      stderr += d.toString();
    });

    child.on("error", (err) => reject(err));

    child.on("close", (code) => {
      if (code !== 0 && code !== 1) {
        if (stderr.trim()) {
          return reject(new Error(stderr.trim()));
        }
      }

      const lines = stdout.trim() ? stdout.trim().split("\n") : [];
      if (lines.length === 0) {
        return resolve(`No matches for /${args.pattern}/${args.case_insensitive ? "i" : ""}`);
      }

      const formatted = lines
        .slice(offset, offset + limit)
        .map((line) => {
          // Normalize relative path in line output
          const firstColon = line.indexOf(":");
          if (firstColon === -1) return line;
          const secondColon = line.indexOf(":", firstColon + 1);
          if (secondColon === -1) return line;

          const fileAbs = line.slice(0, firstColon);
          const lineNum = line.slice(firstColon + 1, secondColon);
          const text = line.slice(secondColon + 1);
          const rel = ws.relative(fileAbs);
          return `${rel}:${lineNum}: ${text.trim()}`;
        });

      const truncated = lines.length > offset + limit ? `\n(truncated at ${limit} results)` : "";
      resolve(formatted.join("\n") + truncated);
    });
  });
}

async function executeJsGrep(
  ws: Workspace,
  rootAbs: string,
  args: {
    pattern: string;
    include?: string;
    case_insensitive?: boolean;
  },
  limit: number,
  offset: number
): Promise<string> {
  let regex: RegExp;
  try {
    regex = new RegExp(args.pattern, args.case_insensitive ? "i" : "");
  } catch (e) {
    throw new Error(`Invalid regex: ${e instanceof Error ? e.message : e}`);
  }

  const includeRe = args.include ? includeGlobToRegex(args.include) : null;
  const matches: Match[] = [];
  let filesSearched = 0;

  await walk(rootAbs, async (abs) => {
    if (matches.length >= limit + offset) return;
    const rel = ws.relative(abs);
    if (includeRe && !includeRe.test(path.basename(abs))) return;
    filesSearched++;
    const found = await searchFile(abs, regex, rel);
    matches.push(...found);
  });

  if (matches.length === 0) {
    return `No matches for /${args.pattern}/${args.case_insensitive ? "i" : ""} (searched ${filesSearched} files via fallback walker)`;
  }

  const sliced = matches.slice(offset, offset + limit);
  const truncated = matches.length > offset + limit ? `\n(truncated at ${limit})` : "";
  return sliced.map((m) => `${m.file}:${m.line}: ${m.text.trim()}`).join("\n") + truncated;
}

function includeGlobToRegex(glob: string): RegExp {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]");
  return new RegExp(`^${escaped}$`);
}

async function walk(dir: string, visit: (abs: string) => Promise<void>): Promise<void> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(abs, visit);
    } else if (entry.isFile()) {
      await visit(abs);
    }
  }
}

async function searchFile(abs: string, regex: RegExp, rel: string): Promise<Match[]> {
  const ext = path.extname(abs).toLowerCase();
  const hasKnownTextExt = TEXT_EXTENSIONS.has(ext);
  if (!hasKnownTextExt && ext !== "") return [];

  try {
    const stat = await fs.stat(abs);
    if (stat.size > MAX_FILE_SIZE || stat.size === 0) return [];
    const raw = await fs.readFile(abs, "utf8");
    if (raw.includes("\0")) return [];

    const matches: Match[] = [];
    const lines = raw.split("\n");
    for (let i = 0; i < lines.length && matches.length < DEFAULT_MAX_MATCHES; i++) {
      if (regex.test(lines[i])) {
        matches.push({ file: rel, line: i + 1, text: lines[i] });
      }
      regex.lastIndex = 0;
    }
    return matches;
  } catch {
    return [];
  }
}
