import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, readdirSync } from "node:fs";
import * as path from "node:path";
import { getConfigDir } from "../config.js";
import type {
  MemoryCategory,
  MemoryScope,
  MemoryRecord,
  MemoryStoreInput,
  MemorySearchResult,
  MemoryManagerOptions,
} from "./types.js";

const VALID_CATEGORIES: MemoryCategory[] = ["user", "feedback", "project", "reference"];

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Parses simple YAML-like frontmatter from a markdown file without external dependencies.
 */
export function parseMemoryFrontmatter(rawContent: string): {
  frontmatter: Record<string, any>;
  body: string;
} {
  const match = rawContent.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    return { frontmatter: {}, body: rawContent.trim() };
  }

  const [, yamlBlock, body] = match;
  const frontmatter: Record<string, any> = {};

  for (const line of yamlBlock.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const colonIdx = trimmed.indexOf(":");
    if (colonIdx === -1) continue;

    const key = trimmed.slice(0, colonIdx).trim();
    const rawVal = trimmed.slice(colonIdx + 1).trim();

    if (rawVal.startsWith("[") && rawVal.endsWith("]")) {
      const items = rawVal
        .slice(1, -1)
        .split(",")
        .map((s) => s.trim().replace(/^["']|["']$/g, ""))
        .filter(Boolean);
      frontmatter[key] = items;
    } else if (rawVal === "true") {
      frontmatter[key] = true;
    } else if (rawVal === "false") {
      frontmatter[key] = false;
    } else if (/^\d+$/.test(rawVal)) {
      frontmatter[key] = parseInt(rawVal, 10);
    } else {
      frontmatter[key] = rawVal.replace(/^["']|["']$/g, "");
    }
  }

  return { frontmatter, body: body.trim() };
}

/**
 * Formats a memory record into standard markdown with frontmatter.
 */
export function formatMemoryFile(record: MemoryRecord): string {
  const tagsStr = `[${record.tags.map((t) => `"${t}"`).join(", ")}]`;
  return `---
id: "${record.id}"
category: "${record.category}"
scope: "${record.scope}"
title: "${record.title.replace(/"/g, '\\"')}"
tags: ${tagsStr}
createdAt: ${record.createdAt}
updatedAt: ${record.updatedAt}
---

${record.content.trim()}
`;
}

export class MemoryManager {
  private readonly workspaceRoot: string;
  private readonly globalDir: string;

  constructor(options: MemoryManagerOptions) {
    this.workspaceRoot = options.workspaceRoot;
    this.globalDir = options.globalDir ?? path.join(getConfigDir(), "memory");
  }

  getMemoryDir(scope: MemoryScope): string {
    return scope === "workspace"
      ? path.join(this.workspaceRoot, ".ruid", "memory")
      : this.globalDir;
  }

  private ensureDirectories(scope: MemoryScope): void {
    const baseDir = this.getMemoryDir(scope);
    if (!existsSync(baseDir)) {
      mkdirSync(baseDir, { recursive: true });
    }
    for (const cat of VALID_CATEGORIES) {
      const catDir = path.join(baseDir, cat);
      if (!existsSync(catDir)) {
        mkdirSync(catDir, { recursive: true });
      }
    }
  }

  async store(input: MemoryStoreInput): Promise<MemoryRecord> {
    const scope: MemoryScope = input.scope ?? "workspace";
    const category: MemoryCategory = VALID_CATEGORIES.includes(input.category)
      ? input.category
      : "project";

    this.ensureDirectories(scope);

    const id = input.id
      ? slugify(input.id)
      : input.title
        ? slugify(input.title)
        : `mem-${Date.now()}`;

    const title = input.title || id.replace(/-/g, " ");
    const tags = input.tags ?? [];
    const baseDir = this.getMemoryDir(scope);
    const filePath = path.join(baseDir, category, `${id}.md`);

    const now = Date.now();
    let createdAt = now;

    if (existsSync(filePath)) {
      try {
        const existing = readFileSync(filePath, "utf8");
        const { frontmatter } = parseMemoryFrontmatter(existing);
        if (typeof frontmatter.createdAt === "number") {
          createdAt = frontmatter.createdAt;
        }
      } catch {
        // Fallback to now
      }
    }

    const record: MemoryRecord = {
      id,
      category,
      scope,
      title,
      content: input.content.trim(),
      tags,
      createdAt,
      updatedAt: now,
      filePath,
    };

    writeFileSync(filePath, formatMemoryFile(record), "utf8");
    await this.rebuildIndex(scope);
    return record;
  }

  async list(filter?: { category?: MemoryCategory; scope?: MemoryScope }): Promise<MemoryRecord[]> {
    const scopes: MemoryScope[] = filter?.scope
      ? [filter.scope]
      : ["workspace", "global"];

    const records: MemoryRecord[] = [];

    for (const scope of scopes) {
      const baseDir = this.getMemoryDir(scope);
      if (!existsSync(baseDir)) continue;

      const categories = filter?.category ? [filter.category] : VALID_CATEGORIES;

      for (const cat of categories) {
        const catDir = path.join(baseDir, cat);
        if (!existsSync(catDir)) continue;

        const files = readdirSync(catDir).filter((f) => f.endsWith(".md"));
        for (const file of files) {
          const filePath = path.join(catDir, file);
          try {
            const raw = readFileSync(filePath, "utf8");
            const { frontmatter, body } = parseMemoryFrontmatter(raw);
            const id = (frontmatter.id as string) || path.basename(file, ".md");
            const title = (frontmatter.title as string) || id;
            const tags = Array.isArray(frontmatter.tags) ? frontmatter.tags : [];
            const createdAt = typeof frontmatter.createdAt === "number" ? frontmatter.createdAt : 0;
            const updatedAt = typeof frontmatter.updatedAt === "number" ? frontmatter.updatedAt : 0;

            records.push({
              id,
              category: cat,
              scope,
              title,
              content: body,
              tags,
              createdAt,
              updatedAt,
              filePath,
            });
          } catch {
            // Ignore unreadable memory files
          }
        }
      }
    }

    return records.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async recall(
    query: string,
    filter?: { category?: MemoryCategory; scope?: MemoryScope }
  ): Promise<MemorySearchResult[]> {
    const all = await this.list(filter);
    if (!query.trim()) {
      return all.map((record) => ({
        record,
        score: 1,
        snippet: record.content.slice(0, 160),
      }));
    }

    const terms = query
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length > 1);

    const results: MemorySearchResult[] = [];

    for (const record of all) {
      const titleLower = record.title.toLowerCase();
      const contentLower = record.content.toLowerCase();
      const tagsLower = record.tags.map((t) => t.toLowerCase());

      let score = 0;
      for (const term of terms) {
        if (record.id.toLowerCase().includes(term)) score += 5;
        if (titleLower.includes(term)) score += 4;
        if (tagsLower.some((t) => t.includes(term))) score += 3;
        if (contentLower.includes(term)) score += 1;
      }

      if (score > 0) {
        // Find best snippet line
        const lines = record.content.split("\n");
        const matchingLine = lines.find((l) => terms.some((t) => l.toLowerCase().includes(t))) || lines[0] || "";
        const snippet = matchingLine.trim().slice(0, 160);

        results.push({ record, score, snippet });
      }
    }

    return results.sort((a, b) => b.score - a.score);
  }

  async forget(id: string, scope?: MemoryScope): Promise<boolean> {
    const targetScopes: MemoryScope[] = scope ? [scope] : ["workspace", "global"];
    let deleted = false;

    for (const s of targetScopes) {
      const baseDir = this.getMemoryDir(s);
      if (!existsSync(baseDir)) continue;

      for (const cat of VALID_CATEGORIES) {
        const filePath = path.join(baseDir, cat, `${slugify(id)}.md`);
        if (existsSync(filePath)) {
          try {
            unlinkSync(filePath);
            deleted = true;
            await this.rebuildIndex(s);
          } catch {
            // continue
          }
        }
      }
    }

    return deleted;
  }

  async rebuildIndex(scope: MemoryScope): Promise<string> {
    const baseDir = this.getMemoryDir(scope);
    this.ensureDirectories(scope);

    const records = await this.list({ scope });
    const byCategory: Record<MemoryCategory, MemoryRecord[]> = {
      user: [],
      feedback: [],
      project: [],
      reference: [],
    };

    for (const r of records) {
      byCategory[r.category]?.push(r);
    }

    const lines: string[] = [
      `# Agent Memory Index (${scope === "workspace" ? "Workspace" : "Global"})`,
      "",
    ];

    const categoryLabels: Record<MemoryCategory, string> = {
      user: "User Profile & Preferences",
      feedback: "Feedback, Rules & Guardrails",
      project: "Project Guidelines & Architecture",
      reference: "References & External Pointers",
    };

    for (const cat of VALID_CATEGORIES) {
      const items = byCategory[cat];
      if (!items || items.length === 0) continue;

      lines.push(`## ${categoryLabels[cat]}`);
      for (const item of items) {
        const hook = item.content.split("\n")[0]?.trim() || item.title;
        lines.push(`- **[${item.id}]** (${item.category}): ${item.title} — ${hook.slice(0, 120)}`);
      }
      lines.push("");
    }

    const indexContent = lines.join("\n").trim() + "\n";
    const indexPath = path.join(baseDir, "MEMORY.md");
    writeFileSync(indexPath, indexContent, "utf8");

    // Also mirror to workspace root MEMORY.md if in workspace scope
    if (scope === "workspace") {
      const rootMemoryPath = path.join(this.workspaceRoot, "MEMORY.md");
      // Only mirror to root if it exists or if root doesn't have an unrelated user file
      if (existsSync(rootMemoryPath)) {
        try {
          const currentRoot = readFileSync(rootMemoryPath, "utf8");
          if (currentRoot.startsWith("# Agent Memory Index") || currentRoot.includes("<!-- ruid-memory -->")) {
            writeFileSync(rootMemoryPath, indexContent, "utf8");
          }
        } catch {}
      }
    }

    return indexContent;
  }

  /**
   * Generates formatted aggregate memory markdown for system prompt injection.
   * Strictly caps output at maxLines (default: 200).
   */
  async getSystemPromptSummary(maxLines = 200): Promise<string | null> {
    const workspaceRecords = await this.list({ scope: "workspace" });
    const globalRecords = await this.list({ scope: "global" });

    if (workspaceRecords.length === 0 && globalRecords.length === 0) {
      return null;
    }

    const lines: string[] = [];

    if (workspaceRecords.length > 0) {
      lines.push("--- Workspace Memory ---");
      for (const rec of workspaceRecords) {
        const firstLine = rec.content.split("\n")[0]?.trim() || "";
        lines.push(`- [${rec.id}] (${rec.category}) ${rec.title}: ${firstLine.slice(0, 140)}`);
      }
    }

    if (globalRecords.length > 0) {
      if (lines.length > 0) lines.push("");
      lines.push("--- Global Memory ---");
      for (const rec of globalRecords) {
        const firstLine = rec.content.split("\n")[0]?.trim() || "";
        lines.push(`- [${rec.id}] (${rec.category}) ${rec.title}: ${firstLine.slice(0, 140)}`);
      }
    }

    if (lines.length > maxLines) {
      return lines.slice(0, maxLines - 1).join("\n") + "\n... [truncated to 200 lines limit]";
    }

    return lines.join("\n");
  }
}
