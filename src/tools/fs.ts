import { z } from "zod";
import { promises as fs, existsSync, statSync } from "node:fs";
import * as path from "node:path";

// All paths resolve inside the workspace root; absolute paths outside it are
// rejected so a confused model can't wander the filesystem.
export class Workspace {
  constructor(readonly root: string) {}

  resolve(p: string): string {
    // Normalize forward slashes first — path.normalize on Windows leaves
    // mixed/doubled separators like "a\\..\\..\\b" uncollapsed.
    const unified = p.replace(/[/\\]+/g, "/");
    const abs = path.isAbsolute(unified) ? unified : path.join(this.root, unified);
    const normalized = path.normalize(abs);
    const rootNorm = path.normalize(this.root);
    if (normalized !== rootNorm && !normalized.startsWith(rootNorm + path.sep)) {
      throw new Error(
        `Path "${p}" escapes workspace root "${this.root}". File tools (read_file, write_file, edit_file) only operate inside the workspace root. Use relative paths within the workspace, or use the bash tool with absolute paths for operations outside the workspace root.`
      );
    }
    return normalized;
  }

  relative(p: string): string {
    return path.relative(this.root, p) || ".";
  }
}

const MAX_READ_BYTES = 512 * 1024;

export function readFileTool(ws: Workspace) {
  return {
    name: "read_file",
    description:
      "Read a text file. Returns the full content with line numbers. Fails on binary files or files > 512KB.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path relative to workspace root" },
        offset: { type: "number", description: "1-based line number to start from (optional)" },
        limit: { type: "number", description: "Max lines to read (optional)" },
      },
      required: ["path"],
    },
    schema: z.object({
      path: z.string().min(1),
      offset: z.number().int().min(1).optional(),
      limit: z.number().int().min(1).max(5000).optional(),
    }),
    async execute(args: { path: string; offset?: number; limit?: number }): Promise<string> {
      const abs = ws.resolve(args.path);
      if (!existsSync(abs)) throw new Error(`File not found: ${args.path}`);
      const st = statSync(abs);
      if (st.isDirectory()) throw new Error(`${args.path} is a directory`);
      if (st.size > MAX_READ_BYTES) throw new Error(`File too large (${st.size} bytes)`);

      const raw = await fs.readFile(abs, "utf8");
      // Cheap binary sniff: NUL byte in the first chunk
      if (raw.includes("\0")) throw new Error(`Binary file: ${args.path}`);

      const lines = raw.split("\n");
      const start = args.offset ?? 1;
      const end = Math.min(lines.length, start - 1 + (args.limit ?? lines.length));
      const slice = lines.slice(start - 1, end);
      return slice.map((l, i) => `${start + i}\t${l}`).join("\n");
    },
  };
}

import type { SnapshotManager } from "./snapshot.js";

export function writeFileTool(ws: Workspace, snapshots?: SnapshotManager) {
  return {
    name: "write_file",
    description:
      "Create or overwrite a file with the given content. Parent directories are created automatically. Prefer edit_file for modifying existing files.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path relative to workspace root" },
        content: { type: "string", description: "Full new file content" },
      },
      required: ["path", "content"],
    },
    schema: z.object({
      path: z.string().min(1),
      content: z.string(),
    }),
    async execute(args: { path: string; content: string }): Promise<string> {
      const abs = ws.resolve(args.path);
      const rel = ws.relative(abs);
      snapshots?.capture(ws.root, rel);
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.writeFile(abs, args.content, "utf8");
      const lineCount = args.content.split("\n").length;
      return `Wrote ${lineCount} lines to ${rel}`;
    },
  };
}

export function editFileTool(ws: Workspace, snapshots?: SnapshotManager) {
  return {
    name: "edit_file",
    description:
      "Replace an exact substring in a file. old_string must match exactly and uniquely — include surrounding lines for uniqueness. Use replace_all for repeated occurrences.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path relative to workspace root" },
        old_string: { type: "string", description: "Exact text to find" },
        new_string: { type: "string", description: "Replacement text" },
        replace_all: { type: "boolean", description: "Replace every occurrence (default false)" },
      },
      required: ["path", "old_string", "new_string"],
    },
    schema: z.object({
      path: z.string().min(1),
      old_string: z.string().min(1),
      new_string: z.string(),
      replace_all: z.boolean().optional().default(false),
    }),
    async execute(args: {
      path: string;
      old_string: string;
      new_string: string;
      replace_all?: boolean;
    }): Promise<string> {
      const abs = ws.resolve(args.path);
      const rel = ws.relative(abs);
      if (!existsSync(abs)) throw new Error(`File not found: ${args.path}`);

      const raw = await fs.readFile(abs, "utf8");
      const occurrences = raw.split(args.old_string).length - 1;
      if (occurrences === 0) {
        throw new Error(
          `old_string not found in ${args.path}. Check exact whitespace/indentation.`,
        );
      }
      if (occurrences > 1 && !args.replace_all) {
        throw new Error(
          `old_string matches ${occurrences} times in ${args.path}. Add more context to make it unique, or set replace_all=true.`,
        );
      }
      snapshots?.capture(ws.root, rel);
      const updated = args.replace_all
        ? raw.split(args.old_string).join(args.new_string)
        : raw.replace(args.old_string, args.new_string);
      await fs.writeFile(abs, updated, "utf8");
      return `Edited ${rel} (${occurrences} replacement${occurrences > 1 ? "s" : ""})`;
    },
  };
}

export function listDirTool(ws: Workspace) {
  return {
    name: "list_dir",
    description: "List files and subdirectories of a directory.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Directory path (default: workspace root)" },
      },
      required: [],
    },
    schema: z.object({ path: z.string().optional() }),
    async execute(args: { path?: string }): Promise<string> {
      const abs = ws.resolve(args.path ?? ".");
      if (!existsSync(abs)) throw new Error(`Directory not found: ${args.path ?? "."}`);
      const entries = await fs.readdir(abs, { withFileTypes: true });
      const sorted = entries.sort((a, b) =>
        Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name),
      );
      if (sorted.length === 0) return "(empty)";
      return sorted.map((e) => (e.isDirectory() ? `${e.name}/` : e.name)).join("\n");
    },
  };
}

const DEFAULT_IGNORE_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "out",
  ".next",
  ".venv",
  "venv",
  "__pycache__",
  ".cache",
  ".turbo",
  ".idea",
  ".vscode",
]);

/**
 * Converts standard glob patterns (*, **, ?, {a,b}) to a RegExp.
 */
export function globPatternToRegex(pattern: string): RegExp {
  // Normalize Windows backslashes
  let p = pattern.replace(/\\/g, "/").trim();
  // Strip leading ./ if present
  if (p.startsWith("./")) p = p.slice(2);

  let regexStr = "";
  let i = 0;
  while (i < p.length) {
    const c = p[i];
    if (c === "*" && p[i + 1] === "*") {
      // ** matches across directories
      if (p[i + 2] === "/") {
        regexStr += "(?:.+/)?";
        i += 3;
      } else {
        regexStr += ".*";
        i += 2;
      }
    } else if (c === "*") {
      // * matches anything except path separator
      regexStr += "[^/]*";
      i++;
    } else if (c === "?") {
      regexStr += "[^/]";
      i++;
    } else if (c === "{" || c === "}") {
      // Brace expansion {ts,tsx} -> (ts|tsx)
      regexStr += c === "{" ? "(" : ")";
      i++;
    } else if (c === "," && regexStr.includes("(")) {
      regexStr += "|";
      i++;
    } else if (/[.+^$|()[\]\\]/.test(c)) {
      regexStr += "\\" + c;
      i++;
    } else {
      regexStr += c;
      i++;
    }
  }

  return new RegExp(`^${regexStr}$`, "i");
}

/**
 * Pure Node.js recursive directory walker that matches glob patterns
 * without depending on Node 22 fs.globSync.
 */
async function globSearch(rootAbs: string, pattern: string, maxResults: number): Promise<string[]> {
  const matcher = globPatternToRegex(pattern);
  const results: string[] = [];

  // Check if pattern explicitly includes ignore dirs (e.g. node_modules/**)
  const normPattern = pattern.replace(/\\/g, "/");
  const searchingIgnored = Array.from(DEFAULT_IGNORE_DIRS).some(
    (d) => normPattern.startsWith(`${d}/`) || normPattern.startsWith(`./${d}/`) || normPattern === d
  );

  async function walk(currentAbs: string): Promise<void> {
    if (results.length >= maxResults) return;
    let entries;
    try {
      entries = await fs.readdir(currentAbs, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (results.length >= maxResults) return;
      if (!searchingIgnored && DEFAULT_IGNORE_DIRS.has(entry.name)) {
        continue;
      }

      const entryAbs = path.join(currentAbs, entry.name);
      const relPath = path.relative(rootAbs, entryAbs).replace(/\\/g, "/");

      if (entry.isFile() || entry.isSymbolicLink()) {
        if (matcher.test(relPath) || matcher.test(entry.name)) {
          results.push(relPath);
        }
      } else if (entry.isDirectory()) {
        if (matcher.test(relPath) || matcher.test(`${relPath}/`)) {
          results.push(`${relPath}/`);
        }
        await walk(entryAbs);
      }
    }
  }

  await walk(rootAbs);
  return results.slice(0, maxResults);
}

export function globTool(ws: Workspace) {
  return {
    name: "glob",
    description: "Find files by glob pattern (e.g. \"src/**/*.ts\"). Returns up to 200 paths.",
    parameters: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Glob pattern relative to workspace root" },
      },
      required: ["pattern"],
    },
    schema: z.object({ pattern: z.string().min(1) }),
    async execute(args: { pattern: string }): Promise<string> {
      let results: string[];
      try {
        results = await globSearch(ws.root, args.pattern, 200);
      } catch (e) {
        throw new Error(`Glob failed: ${e instanceof Error ? e.message : e}`);
      }
      if (results.length === 0) return `No files match "${args.pattern}"`;
      const suffix = results.length === 200 ? "\n(truncated at 200 results)" : "";
      return results.join("\n") + suffix;
    },
  };
}
