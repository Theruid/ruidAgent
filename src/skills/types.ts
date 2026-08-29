import type { AgentMode } from "../permissions.js";

export interface SkillMetadata {
  name: string;
  description: string;
  args?: string;
  mode?: AgentMode;
  tags?: string[];
  scope: "workspace" | "global";
  filePath: string;
}

export interface Skill extends SkillMetadata {
  instructions: string;
  rawContent: string;
}

export interface SkillRunResult {
  skill: Skill;
  renderedInstructions: string;
  mode?: AgentMode;
}
