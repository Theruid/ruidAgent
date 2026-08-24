import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export interface DiffLine {
  type: "header" | "hunk" | "add" | "del" | "ctx";
  text: string;
}

/**
 * Computes a unified diff between oldText and newText.
 */
export function computeUnifiedDiff(
  filePath: string,
  oldText: string,
  newText: string,
  maxLines = 14,
): DiffLine[] {
  const oldLines = oldText.split(/\r?\n/);
  const newLines = newText.split(/\r?\n/);

  const diffLines: DiffLine[] = [
    { type: "header", text: `--- a/${filePath}` },
    { type: "header", text: `+++ b/${filePath}` },
  ];

  // Find prefix match
  let start = 0;
  while (
    start < oldLines.length &&
    start < newLines.length &&
    oldLines[start] === newLines[start]
  ) {
    start++;
  }

  // Find suffix match
  let oldEnd = oldLines.length - 1;
  let newEnd = newLines.length - 1;
  while (
    oldEnd >= start &&
    newEnd >= start &&
    oldLines[oldEnd] === newLines[newEnd]
  ) {
    oldEnd--;
    newEnd--;
  }

  // Include up to 2 context lines before
  const ctxStart = Math.max(0, start - 2);
  for (let i = ctxStart; i < start; i++) {
    diffLines.push({ type: "ctx", text: `  ${oldLines[i]}` });
  }

  // Deleted lines
  for (let i = start; i <= oldEnd; i++) {
    diffLines.push({ type: "del", text: `- ${oldLines[i]}` });
  }

  // Added lines
  for (let i = start; i <= newEnd; i++) {
    diffLines.push({ type: "add", text: `+ ${newLines[i]}` });
  }

  // Include up to 2 context lines after
  const ctxEnd = Math.min(oldLines.length - 1, oldEnd + 2);
  for (let i = oldEnd + 1; i <= ctxEnd; i++) {
    diffLines.push({ type: "ctx", text: `  ${oldLines[i]}` });
  }

  if (diffLines.length > maxLines) {
    const truncated = diffLines.slice(0, maxLines);
    truncated.push({
      type: "hunk",
      text: `... (+${diffLines.length - maxLines} more lines)`,
    });
    return truncated;
  }

  return diffLines;
}

/**
 * Creates visual diff for edit_file or write_file permission requests.
 */
export function getToolDiff(
  toolName: string,
  input: unknown,
  cwd = process.cwd(),
): DiffLine[] | null {
  if (!input || typeof input !== "object") return null;
  const inp = input as Record<string, unknown>;

  if (toolName === "edit_file" && typeof inp.path === "string") {
    const absPath = resolve(cwd, inp.path);
    if (!existsSync(absPath)) return null;

    try {
      const oldFull = readFileSync(absPath, "utf8");
      const oldStr = String(inp.old_string ?? "");
      const newStr = String(inp.new_string ?? "");
      const newFull = inp.replace_all
        ? oldFull.split(oldStr).join(newStr)
        : oldFull.replace(oldStr, newStr);

      return computeUnifiedDiff(inp.path, oldFull, newFull);
    } catch {
      return null;
    }
  }

  if (toolName === "write_file" && typeof inp.path === "string") {
    const absPath = resolve(cwd, inp.path);
    const newFull = String(inp.content ?? "");

    if (existsSync(absPath)) {
      try {
        const oldFull = readFileSync(absPath, "utf8");
        return computeUnifiedDiff(inp.path, oldFull, newFull);
      } catch {
        return null;
      }
    } else {
      // New file
      const lines = newFull.split(/\r?\n/);
      const diffLines: DiffLine[] = [
        { type: "header", text: `+++ b/${inp.path} (new file, ${lines.length} lines)` },
      ];
      const maxLines = 10;
      for (let i = 0; i < Math.min(lines.length, maxLines); i++) {
        diffLines.push({ type: "add", text: `+ ${lines[i]}` });
      }
      if (lines.length > maxLines) {
        diffLines.push({ type: "hunk", text: `... (+${lines.length - maxLines} more lines)` });
      }
      return diffLines;
    }
  }

  return null;
}
