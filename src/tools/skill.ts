import { z } from "zod";
import type { SkillManager } from "../skills/loader.js";

export function skillRunTool(skillManager: SkillManager) {
  return {
    name: "skill_run" as const,
    description: "Execute a custom workflow or prompt template loaded from .ruid/skills/ or ~/.ruid/skills/.",
    parameters: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Name of the skill to execute (e.g. 'deploy', 'typecheck', 'review').",
        },
        args: {
          type: "string",
          description: "Optional argument string to pass into the skill template.",
        },
      },
      required: ["name"],
    },
    schema: z.object({
      name: z.string(),
      args: z.string().optional(),
    }),
    async execute(args: { name: string; args?: string }): Promise<string> {
      const skill = await skillManager.getSkill(args.name);
      if (!skill) {
        const available = await skillManager.loadSkills();
        const names = available.map((s) => s.name).join(", ");
        return `Skill "${args.name}" not found. Available skills: ${names || "none"}`;
      }

      const rendered = skillManager.renderSkill(skill, args.args);
      return `--- Loaded Skill: ${skill.name} (${skill.scope}) ---
Description: ${skill.description}
${skill.mode ? `Mode: [${skill.mode.toUpperCase()}]\n` : ""}
${rendered}
--- End of Skill ---`;
    },
  };
}
