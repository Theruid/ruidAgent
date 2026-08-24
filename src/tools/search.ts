import { z } from "zod";
import { promises as fs } from "node:fs";
import * as path from "node:path";
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
const MAX_MATCHES = 200;

interface Match {
  file: string;
  line: number;
  text: string;
}

export function grepTool(ws: Workspace) {
  return {
    name: "grep",
    description:
      "Search file contents with a regex (JS syntax). Skips node_modules/.git/build dirs and binary files. Returns up to 200 matches as file:line:text.",
    parameters: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Regular expression" },
        include: {
          type: "string",
          description: 'Optional glob filter for filenames, e.g. "*.ts"',
        },
        path: { type: "string", description: "Directory to search (default: workspace root)" },
        case_insensitive: { type: "boolean", description: "Case-insensitive search (default false)" },
      },
      required: ["pattern"],
    },
    schema: z.object({
      pattern: z.string().min(1),
      include: z.string().optional(),
      path: z.string().optional(),
      case_insensitive: z.boolean().optional().default(false),
    }),
    async execute(args: {
      pattern: string;
      include?: string;
      path?: string;
      case_insensitive?: boolean;
    }): Promise<string> {
      let regex: RegExp;
      try {
        regex = new RegExp(args.pattern, args.case_insensitive ? "i" : "");
      } catch (e) {
        throw new Error(`Invalid regex: ${e instanceof Error ? e.message : e}`);
      }

      const includeRe = args.include
        ? includeGlobToRegex(args.include)
        : null;

      const rootAbs = ws.resolve(args.path ?? ".");
      const matches: Match[] = [];
      let filesSearched = 0;

      await walk(rootAbs, async (abs) => {
        if (matches.length >= MAX_MATCHES) return;
        const rel = ws.relative(abs);
        if (includeRe && !includeRe.test(path.basename(abs))) return;
        filesSearched++;
        const found = await searchFile(abs, regex, rel);
        matches.push(...found);
      });

      if (matches.length === 0) {
        return `No matches for /${args.pattern}/${args.case_insensitive ? "i" : ""} (searched ${filesSearched} files)`;
      }
      const truncated = matches.length >= MAX_MATCHES ? `\n(truncated at ${MAX_MATCHES})` : "";
      return (
        matches.map((m) => `${m.file}:${m.line}: ${m.text.trim()}`).join("\n") + truncated
      );
    },
  };
}

function includeGlobToRegex(glob: string): RegExp {
  // "*.ts" → /^[^/]*\.ts$/ ; simple prefix/suffix wildcards only
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]");
  return new RegExp(`^${escaped}$`);
}

async function walk(dir: string, visit: (abs: string) => Promise<void>): Promise<void> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return; // unreadable dir — skip silently
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
  // Search extensionless files too (Makefile, Dockerfile, LICENSE...) but
  // never unknown binary-ish extensions.
  if (!hasKnownTextExt && ext !== "") return [];

  try {
    const stat = await fs.stat(abs);
    if (stat.size > MAX_FILE_SIZE || stat.size === 0) return [];
    const raw = await fs.readFile(abs, "utf8");
    if (raw.includes("\0")) return []; // binary

    const matches: Match[] = [];
    const lines = raw.split("\n");
    for (let i = 0; i < lines.length && matches.length < MAX_MATCHES; i++) {
      if (regex.test(lines[i])) {
        matches.push({ file: rel, line: i + 1, text: lines[i] });
      }
      regex.lastIndex = 0; // guard against global-flag statefulness
    }
    return matches;
  } catch {
    return [];
  }
}
