import { z } from "zod";
import { promises as fs, existsSync, statSync, readFileSync, writeFileSync, renameSync, realpathSync } from "node:fs";
import * as path from "node:path";
import { isPathSensitive } from "../permissions.js";
import { createHash } from "node:crypto";

export interface FileFormat {
  eol: "\r\n" | "\n";
  hasBom: boolean;
  content: string;
}

export function detectFileFormat(rawBuffer: Buffer): FileFormat {
  let hasBom = false;
  let content: string;
  if (rawBuffer.length >= 3 && rawBuffer[0] === 0xef && rawBuffer[1] === 0xbb && rawBuffer[2] === 0xbf) {
    hasBom = true;
    content = rawBuffer.subarray(3).toString("utf8");
  } else {
    content = rawBuffer.toString("utf8");
  }
  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  return { eol, hasBom, content };
}

export interface MatchResult {
  updated: string;
  matchType: "exact" | "trailing_whitespace" | "indentation";
  occurrences: number;
}

export function performMatchLadder(
  content: string,
  oldString: string,
  newString: string,
  replaceAll: boolean
): MatchResult {
  // Normalize newlines in oldString and newString to match content EOL
  const contentEol = content.includes("\r\n") ? "\r\n" : "\n";
  const normalizedOld = oldString.replace(/\r?\n/g, contentEol);
  const normalizedNew = newString.replace(/\r?\n/g, contentEol);

  // 1. Exact Match
  if (content.includes(normalizedOld)) {
    const occurrences = content.split(normalizedOld).length - 1;
    if (occurrences > 1 && !replaceAll) {
      throw new Error(
        `old_string matches ${occurrences} times in file. Add more surrounding context to make it unique, or set replace_all=true.`
      );
    }
    const updated = replaceAll
      ? content.split(normalizedOld).join(normalizedNew)
      : content.replace(normalizedOld, normalizedNew);
    return { updated, matchType: "exact", occurrences };
  }

  // 2. Trailing Whitespace Insensitive Match
  const contentLines = content.split(/\r?\n/);
  const oldLines = normalizedOld.split(/\r?\n/);
  const newLines = normalizedNew.split(/\r?\n/);

  const cleanOld = oldLines.map((l) => l.trimEnd());
  const matches: number[] = [];

  for (let i = 0; i <= contentLines.length - cleanOld.length; i++) {
    const window = contentLines.slice(i, i + cleanOld.length).map((l) => l.trimEnd());
    if (window.every((line, idx) => line === cleanOld[idx])) {
      matches.push(i);
    }
  }

  if (matches.length > 0) {
    if (matches.length > 1 && !replaceAll) {
      throw new Error(
        `old_string matched ${matches.length} times with trailing whitespace differences at lines ${matches.map((m) => m + 1).join(", ")}. Provide more surrounding lines.`
      );
    }

    let updatedLines = [...contentLines];
    if (replaceAll) {
      for (let idx = matches.length - 1; idx >= 0; idx--) {
        const matchIdx = matches[idx];
        updatedLines.splice(matchIdx, cleanOld.length, ...newLines);
      }
    } else {
      updatedLines.splice(matches[0], cleanOld.length, ...newLines);
    }

    return { updated: updatedLines.join(contentEol), matchType: "trailing_whitespace", occurrences: matches.length };
  }

  // 3. Indentation Normalized Unique Match
  const strippedOld = oldLines.map((l) => l.trim());
  const indentMatches: number[] = [];

  for (let i = 0; i <= contentLines.length - strippedOld.length; i++) {
    const window = contentLines.slice(i, i + strippedOld.length).map((l) => l.trim());
    if (window.every((line, idx) => line === strippedOld[idx])) {
      indentMatches.push(i);
    }
  }

  if (indentMatches.length === 1 || (indentMatches.length > 1 && replaceAll)) {
    let updatedLines = [...contentLines];
    if (replaceAll) {
      for (let idx = indentMatches.length - 1; idx >= 0; idx--) {
        const matchIdx = indentMatches[idx];
        updatedLines.splice(matchIdx, strippedOld.length, ...newLines);
      }
    } else {
      updatedLines.splice(indentMatches[0], strippedOld.length, ...newLines);
    }
    return { updated: updatedLines.join(contentEol), matchType: "indentation", occurrences: indentMatches.length };
  }

  if (indentMatches.length > 1) {
    throw new Error(
      `old_string matched ${indentMatches.length} candidates with varying indentation at lines ${indentMatches.map((m) => m + 1).join(", ")}. Add more surrounding context.`
    );
  }

  throw new Error(`old_string not found in file. Check exact whitespace, line endings, or context lines.`);
}

export class Workspace {
  private readonly normalizedRoot: string;
  private readonly realRoot: string;
  private readonly fileReadHashes = new Map<string, string>();

  constructor(readonly root: string) {
    this.normalizedRoot = path.normalize(root);
    try {
      this.realRoot = existsSync(root) ? realpathSync(root) : this.normalizedRoot;
    } catch {
      this.realRoot = this.normalizedRoot;
    }
  }

  resolve(p: string): string {
    const unified = p.replace(/[/\\]+/g, "/");
    const abs = path.isAbsolute(unified) ? unified : path.join(this.root, unified);
    const normalized = path.normalize(abs);

    const isWindows = process.platform === "win32";
    const compareNorm = isWindows ? normalized.toLowerCase() : normalized;
    const compareRoot = isWindows ? this.normalizedRoot.toLowerCase() : this.normalizedRoot;

    if (compareNorm !== compareRoot && !compareNorm.startsWith(compareRoot + (isWindows ? "\\" : path.sep))) {
      throw new Error(
        `Path "${p}" escapes workspace root "${this.root}". File tools (read_file, write_file, edit_file) only operate inside the workspace root.`
      );
    }

    // Also verify physical realpath if file exists to prevent symlink traversal
    if (existsSync(normalized)) {
      try {
        const real = realpathSync(normalized);
        const compareReal = isWindows ? real.toLowerCase() : real;
        const compareRealRoot = isWindows ? this.realRoot.toLowerCase() : this.realRoot;
        if (compareReal !== compareRealRoot && !compareReal.startsWith(compareRealRoot + (isWindows ? "\\" : path.sep))) {
          throw new Error(`Path "${p}" resolves through symlink outside workspace root.`);
        }
      } catch (err: any) {
        if (err?.message?.includes("outside workspace root")) throw err;
      }
    }

    return normalized;
  }

  relative(p: string): string {
    return path.relative(this.root, p).replace(/\\/g, "/") || ".";
  }

  recordRead(relPath: string, content: string): void {
    const hash = createHash("sha256").update(content).digest("hex");
    this.fileReadHashes.set(relPath.replace(/\\/g, "/"), hash);
  }

  verifyNotModifiedExternally(relPath: string, currentContent: string): void {
    const normalizedRel = relPath.replace(/\\/g, "/");
    const previousHash = this.fileReadHashes.get(normalizedRel);
    if (previousHash) {
      const currentHash = createHash("sha256").update(currentContent).digest("hex");
      if (currentHash !== previousHash) {
        // File modified on disk since agent read it
        throw new Error(
          `File '${normalizedRel}' was modified on disk since your last read. Please re-read the file before applying modifications.`
        );
      }
    }
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

      const rawBuf = await fs.readFile(abs);
      if (rawBuf.includes(0)) throw new Error(`Binary file: ${args.path}`);

      const { content } = detectFileFormat(rawBuf);
      const rel = ws.relative(abs);
      ws.recordRead(rel, content);

      const lines = content.split(/\r?\n/);
      const start = args.offset ?? 1;
      const end = Math.min(lines.length, start - 1 + (args.limit ?? lines.length));
      const slice = lines.slice(start - 1, end);
      return slice.map((l, i) => `${start + i}\t${l}`).join("\n");
    },
  };
}

import type { SnapshotManager } from "./snapshot.js";
import { checkFileSyntax } from "./diagnostics.js";

/**
 * Atomically writes a file via temporary file rename, preserving file permissions and BOM
 */
export async function writeAtomic(filePath: string, content: string, preserveBom = false): Promise<void> {
  let mode: number | undefined;
  if (existsSync(filePath)) {
    try {
      mode = statSync(filePath).mode;
    } catch {}
  }

  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  const tempPath = `${filePath}.${Date.now()}.${Math.random().toString(36).slice(2, 6)}.tmp`;

  let outBuf: Buffer;
  if (preserveBom) {
    const bom = Buffer.from([0xef, 0xbb, 0xbf]);
    outBuf = Buffer.concat([bom, Buffer.from(content, "utf8")]);
  } else {
    outBuf = Buffer.from(content, "utf8");
  }

  await fs.writeFile(tempPath, outBuf, { mode });
  try {
    renameSync(tempPath, filePath);
  } catch {
    // Windows renameSync fallback if target locked momentarily
    await fs.writeFile(filePath, outBuf, { mode });
    try { await fs.unlink(tempPath); } catch {}
  }
}

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

      if (existsSync(abs)) {
        try {
          const existing = await fs.readFile(abs, "utf8");
          ws.verifyNotModifiedExternally(rel, existing);
        } catch (err: any) {
          if (err.message.includes("modified on disk")) throw err;
        }
      }

      snapshots?.capture(ws.root, rel);
      await writeAtomic(abs, args.content, false);
      ws.recordRead(rel, args.content);

      const lineCount = args.content.split(/\r?\n/).length;
      const diag = checkFileSyntax(rel, args.content);
      const diagWarning = diag.hasErrors
        ? `\n\n[Diagnostic Warning in ${rel} (syntax only; not type-checked)]:\n${diag.messages.join("\n")}`
        : "";
      return `Wrote ${lineCount} lines to ${rel}${diagWarning}`;
    },
  };
}

export function editFileTool(ws: Workspace, snapshots?: SnapshotManager) {
  return {
    name: "edit_file",
    description:
      "Replace text in a file. Matches exact substring with fallback to whitespace/indentation normalization. Supports atomic multi-edit batching.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path relative to workspace root" },
        old_string: { type: "string", description: "Exact text to find (optional if edits array provided)" },
        new_string: { type: "string", description: "Replacement text (optional if edits array provided)" },
        replace_all: { type: "boolean", description: "Replace every occurrence (default false)" },
        edits: {
          type: "array",
          description: "Optional array of atomic edits: [{ old_string, new_string }]",
          items: {
            type: "object",
            properties: {
              old_string: { type: "string" },
              new_string: { type: "string" },
              replace_all: { type: "boolean" },
            },
            required: ["old_string", "new_string"],
          },
        },
      },
      required: ["path"],
    },
    schema: z.object({
      path: z.string().min(1),
      old_string: z.string().optional(),
      new_string: z.string().optional(),
      replace_all: z.boolean().optional().default(false),
      edits: z
        .array(
          z.object({
            old_string: z.string().min(1),
            new_string: z.string(),
            replace_all: z.boolean().optional().default(false),
          })
        )
        .optional(),
    }),
    async execute(args: {
      path: string;
      old_string?: string;
      new_string?: string;
      replace_all?: boolean;
      edits?: Array<{ old_string: string; new_string: string; replace_all?: boolean }>;
    }): Promise<string> {
      const abs = ws.resolve(args.path);
      const rel = ws.relative(abs);
      if (!existsSync(abs)) throw new Error(`File not found: ${args.path}`);

      const rawBuf = await fs.readFile(abs);
      const format = detectFileFormat(rawBuf);
      ws.verifyNotModifiedExternally(rel, format.content);

      let currentContent = format.content;
      let totalReplacements = 0;
      const matchTypes: string[] = [];

      const batchEdits = args.edits && args.edits.length > 0
        ? args.edits
        : args.old_string && args.new_string !== undefined
          ? [{ old_string: args.old_string, new_string: args.new_string, replace_all: args.replace_all ?? false }]
          : [];

      if (batchEdits.length === 0) {
        throw new Error("Must provide either old_string and new_string, or edits array.");
      }

      for (const edit of batchEdits) {
        const res = performMatchLadder(currentContent, edit.old_string, edit.new_string, edit.replace_all ?? false);
        currentContent = res.updated;
        totalReplacements += res.occurrences;
        if (!matchTypes.includes(res.matchType)) matchTypes.push(res.matchType);
      }

      snapshots?.capture(ws.root, rel);
      await writeAtomic(abs, currentContent, format.hasBom);
      ws.recordRead(rel, currentContent);

      const diag = checkFileSyntax(rel, currentContent);
      const diagWarning = diag.hasErrors
        ? `\n\n[Diagnostic Warning in ${rel} (syntax only; not type-checked)]:\n${diag.messages.join("\n")}`
        : "";

      const matchNote = matchTypes.includes("exact") ? "" : ` (used ${matchTypes.join(", ")} matching)`;
      return `Edited ${rel} (${totalReplacements} replacement${totalReplacements > 1 ? "s" : ""}${matchNote})${diagWarning}`;
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
        Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name)
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

export function globPatternToRegex(pattern: string): RegExp {
  let p = pattern.replace(/\\/g, "/").trim();
  if (p.startsWith("./")) p = p.slice(2);

  let regexStr = "";
  let i = 0;
  while (i < p.length) {
    const c = p[i];
    if (c === "*" && p[i + 1] === "*") {
      if (p[i + 2] === "/") {
        regexStr += "(?:.+/)?";
        i += 3;
      } else {
        regexStr += ".*";
        i += 2;
      }
    } else if (c === "*") {
      regexStr += "[^/]*";
      i++;
    } else if (c === "?") {
      regexStr += "[^/]";
      i++;
    } else if (c === "{" || c === "}") {
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

async function globSearch(rootAbs: string, pattern: string, maxResults: number): Promise<{ results: string[]; excludedSensitiveCount: number }> {
  const matcher = globPatternToRegex(pattern);
  const results: string[] = [];
  let excludedSensitiveCount = 0;

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
          // Silently exclude sensitive files unless explicitly queried
          if (isPathSensitive(relPath) && !normPattern.includes(".env") && !normPattern.includes("key") && !normPattern.includes("secret")) {
            excludedSensitiveCount++;
          } else {
            results.push(relPath);
          }
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
  return { results: results.slice(0, maxResults), excludedSensitiveCount };
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
      let searchRes: { results: string[]; excludedSensitiveCount: number };
      try {
        searchRes = await globSearch(ws.root, args.pattern, 200);
      } catch (e) {
        throw new Error(`Glob failed: ${e instanceof Error ? e.message : e}`);
      }
      const { results, excludedSensitiveCount } = searchRes;
      if (results.length === 0) return `No files match "${args.pattern}"`;
      const suffix = results.length === 200 ? "\n(truncated at 200 results)" : "";
      const sensitiveFooter = excludedSensitiveCount > 0 ? `\n[Notice: ${excludedSensitiveCount} sensitive credential file(s) excluded from search]` : "";
      return results.join("\n") + suffix + sensitiveFooter;
    },
  };
}
