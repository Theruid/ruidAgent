import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import * as path from "node:path";
import { getConfigDir } from "../config.js";
import type { AgentMode } from "../permissions.js";
import type { Skill, SkillMetadata } from "./types.js";

/**
 * Parses simple YAML-like frontmatter without external dependencies.
 */
export function parseSkillFrontmatter(rawContent: string): {
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

export interface SkillManagerOptions {
  workspaceRoot: string;
  globalDir?: string;
}

export class SkillManager {
  private readonly workspaceRoot: string;
  private readonly globalDir: string;

  constructor(options: SkillManagerOptions) {
    this.workspaceRoot = options.workspaceRoot;
    this.globalDir = options.globalDir ?? path.join(getConfigDir(), "skills");
  }

  /**
   * Discovers and loads all skills across workspace and global scopes.
   * Workspace skills override global skills with the same name.
   */
  async loadSkills(): Promise<Skill[]> {
    const skillMap = new Map<string, Skill>();

    // 1. Global skills first
    if (existsSync(this.globalDir)) {
      const globalSkills = this.scanDirForSkills(this.globalDir, "global");
      for (const skill of globalSkills) {
        skillMap.set(skill.name.toLowerCase(), skill);
      }
    }

    // 2. Workspace skills (override global)
    const wsSkillsDir = path.join(this.workspaceRoot, ".ruid", "skills");
    if (existsSync(wsSkillsDir)) {
      const wsSkills = this.scanDirForSkills(wsSkillsDir, "workspace");
      for (const skill of wsSkills) {
        skillMap.set(skill.name.toLowerCase(), skill);
      }
    }

    return Array.from(skillMap.values()).sort((a, b) => a.name.localeCompare(b.name));
  }

  private scanDirForSkills(dirPath: string, scope: "workspace" | "global"): Skill[] {
    const skills: Skill[] = [];
    try {
      const entries = readdirSync(dirPath);
      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry);
        const stat = statSync(fullPath);

        // Pattern 1: <name>.md
        if (stat.isFile() && entry.endsWith(".md") && !entry.startsWith(".")) {
          const name = path.basename(entry, ".md");
          const skill = this.parseSkillFile(fullPath, name, scope);
          if (skill) skills.push(skill);
        }
        // Pattern 2: <name>/SKILL.md or <name>/skill.md
        else if (stat.isDirectory() && !entry.startsWith(".")) {
          const skillMdCandidates = [
            path.join(fullPath, "SKILL.md"),
            path.join(fullPath, "skill.md"),
          ];
          for (const cand of skillMdCandidates) {
            if (existsSync(cand)) {
              const skill = this.parseSkillFile(cand, entry, scope);
              if (skill) {
                skills.push(skill);
                break;
              }
            }
          }
        }
      }
    } catch {
      // Ignore unreadable directory
    }
    return skills;
  }

  private parseSkillFile(filePath: string, defaultName: string, scope: "workspace" | "global"): Skill | null {
    try {
      const raw = readFileSync(filePath, "utf8");
      const { frontmatter, body } = parseSkillFrontmatter(raw);

      const name = (frontmatter.name as string) || defaultName;
      const description = (frontmatter.description as string) || `Custom ${name} workflow`;
      const args = typeof frontmatter.args === "string" ? frontmatter.args : undefined;
      const mode = (["code", "plan", "auto"].includes(frontmatter.mode as string)
        ? (frontmatter.mode as AgentMode)
        : undefined);
      const tags = Array.isArray(frontmatter.tags) ? frontmatter.tags : undefined;

      return {
        name,
        description,
        args,
        mode,
        tags,
        scope,
        filePath,
        instructions: body,
        rawContent: raw,
      };
    } catch {
      return null;
    }
  }

  async getSkill(name: string): Promise<Skill | null> {
    const skills = await this.loadSkills();
    const lower = name.toLowerCase().trim().replace(/^\//, "");
    return skills.find((s) => s.name.toLowerCase() === lower) ?? null;
  }

  /**
   * Renders the skill prompt template replacing $ARGS, $*, $ARG1, $ARG2, etc.
   */
  renderSkill(skill: Skill, argsStr = ""): string {
    const trimmedArgs = argsStr.trim();
    let text = skill.instructions;

    const parts = trimmedArgs ? trimmedArgs.split(/\s+/) : [];

    // Replace $ARGS and $*
    text = text.replace(/\$(?:ARGS|\*)/g, trimmedArgs);

    // Replace positional args $ARG1, $ARG2, ...
    for (let i = 0; i < parts.length; i++) {
      const regex = new RegExp(`\\$ARG${i + 1}`, "g");
      text = text.replace(regex, parts[i]);
    }

    // Clean remaining unreplaced positional placeholders
    text = text.replace(/\$ARG\d+/g, "");

    // If args were provided but template had no placeholders, append them cleanly
    if (trimmedArgs && !skill.instructions.includes("$ARGS") && !skill.instructions.includes("$*") && !/\$ARG\d+/.test(skill.instructions)) {
      text = `${text}\n\nArguments: ${trimmedArgs}`;
    }

    return text.trim();
  }

  /**
   * Formats available skills for the <available_skills> XML block in the system prompt.
   */
  formatSystemPromptSkills(skills: Skill[]): string | null {
    if (skills.length === 0) return null;

    const lines: string[] = [
      "<available_skills>",
      "The following custom skills and workflows are available in this workspace:",
    ];

    for (const s of skills) {
      const argsHint = s.args ? ` (args: ${s.args})` : "";
      const modeHint = s.mode ? ` [mode: ${s.mode}]` : "";
      lines.push(`- /${s.name}${argsHint}${modeHint}: ${s.description}`);
    }

    lines.push(
      "When a task or user request relates to any of these skills or their trigger domains, call `skill_run` first before creating or editing files so that you apply its specific instructions and design system.",
      "</available_skills>"
    );

    return lines.join("\n");
  }
}
