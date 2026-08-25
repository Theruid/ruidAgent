import fs from "node:fs";
import path from "node:path";

const IGNORE_DIRS = new Set([
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
 * Recursively lists all relative file paths inside root up to maxFiles.
 */
export function listWorkspaceFiles(root: string, maxFiles = 1000): string[] {
  const files: string[] = [];

  function walk(dir: string): void {
    if (files.length >= maxFiles) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const e of entries) {
      if (files.length >= maxFiles) return;
      if (IGNORE_DIRS.has(e.name)) continue;

      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        walk(full);
      } else if (e.isFile() || e.isSymbolicLink()) {
        const rel = path.relative(root, full).replace(/\\/g, "/");
        files.push(rel);
      }
    }
  }

  walk(root);
  return files;
}

/**
 * Scores and filters files matching a search query.
 */
export function searchFiles(files: string[], query: string, limit = 8): string[] {
  const q = query.toLowerCase().trim().replace(/^@/, "");
  if (!q) return files.slice(0, limit);

  const scored = files
    .map((file) => {
      const lower = file.toLowerCase();
      const base = path.basename(lower);
      let score = -1;

      if (base === q) {
        score = 100;
      } else if (base.startsWith(q)) {
        score = 80;
      } else if (lower.startsWith(q)) {
        score = 70;
      } else if (base.includes(q)) {
        score = 50;
      } else if (lower.includes(q)) {
        score = 30;
      } else {
        // Fuzzy sub-sequence check
        let fi = 0;
        let qi = 0;
        while (fi < lower.length && qi < q.length) {
          if (lower[fi] === q[qi]) qi++;
          fi++;
        }
        if (qi === q.length) score = 10;
      }

      return { file, score };
    })
    .filter((item) => item.score >= 0)
    .sort((a, b) => b.score - a.score || a.file.localeCompare(b.file));

  return scored.slice(0, limit).map((s) => s.file);
}
