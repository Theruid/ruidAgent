import fs from "node:fs";
import { Workspace } from "../../tools/fs.js";
import { isPathSensitive } from "../../permissions.js";

export interface AtMentionResult {
  /** The prompt with attached file contents appended. */
  prompt: string;
  /** Mentions that were not attached, with the reason — shown to the user. */
  skipped: Array<{ path: string; reason: string }>;
}

const MAX_ATTACH_BYTES = 256 * 1024;

/**
 * Scans a user prompt for `@filepath` mentions and attaches file contents.
 * Mentions go through the same workspace containment and sensitive-path
 * rules as read_file: paths outside the workspace (including via symlinks)
 * and secrets such as `.env` files are never attached.
 */
export function resolveAtFileMentions(prompt: string, workspaceRoot: string): AtMentionResult {
  const atRegex = /(?:^|\s)@([a-zA-Z0-9_\-./\\]+\.[a-zA-Z0-9]+)/g;
  const matches = [...prompt.matchAll(atRegex)];
  const skipped: AtMentionResult["skipped"] = [];
  if (matches.length === 0) return { prompt, skipped };

  const ws = new Workspace(workspaceRoot);
  const attachments: string[] = [];
  const seen = new Set<string>();

  for (const m of matches) {
    const rel = m[1].replace(/\\/g, "/");
    if (seen.has(rel)) continue;
    seen.add(rel);

    let abs: string;
    try {
      abs = ws.resolve(rel);
    } catch {
      skipped.push({ path: rel, reason: "outside the workspace" });
      continue;
    }
    if (isPathSensitive(rel)) {
      skipped.push({ path: rel, reason: "sensitive file" });
      continue;
    }
    try {
      const stat = fs.statSync(abs);
      if (!stat.isFile()) continue;
      if (stat.size >= MAX_ATTACH_BYTES) {
        skipped.push({ path: rel, reason: "larger than 256 KB" });
        continue;
      }
      const content = fs.readFileSync(abs, "utf8");
      attachments.push(`\n\n--- Content of @${rel} ---\n${content}\n--- End of @${rel} ---`);
    } catch {
      // Missing or unreadable: leave the mention as plain text.
    }
  }

  return { prompt: attachments.length > 0 ? `${prompt}${attachments.join("")}` : prompt, skipped };
}
