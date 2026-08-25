import { existsSync, readFileSync } from "node:fs";
import * as path from "node:path";

const INSTRUCTION_FILES = [
  "AGENT.md",
  "CLAUDE.md",
  ".agentrules",
  "CODINGAGENT.md",
  ".github/copilot-instructions.md",
];

export function loadProjectInstructions(workspaceRoot: string): string | null {
  const loadedRules: string[] = [];

  for (const relFile of INSTRUCTION_FILES) {
    const absPath = path.join(workspaceRoot, relFile);
    if (existsSync(absPath)) {
      try {
        const content = readFileSync(absPath, "utf8").trim();
        if (content) {
          loadedRules.push(`--- Project Instructions from ${relFile} ---\n${content}`);
        }
      } catch {
        // Skip unreadable files
      }
    }
  }

  return loadedRules.length > 0 ? loadedRules.join("\n\n") : null;
}

export function buildSystemPrompt(workspaceRoot: string, platform: string): string {
  const basePrompt = `You are a coding agent working inside the workspace at ${workspaceRoot} on ${platform}.

You accomplish tasks by using tools: reading, searching, writing, and editing files, running shell commands, and inspecting git status.

Guidelines:
- Explore before you act. Use list_dir, glob, grep, and read_file to understand the codebase before making changes.
- Make focused changes. Fix what was asked; don't refactor unrelated code.
- edit_file requires an exact old_string match — read the file first so you copy text exactly, including indentation.
- Verify your work when possible: run the code or tests after changing them.
- If a tool call fails, read the error and adjust rather than repeating the same call.
- Be concise in your final answer: what changed and where.

File paths in tool arguments are relative to the workspace root.`;

  const customInstructions = loadProjectInstructions(workspaceRoot);
  if (customInstructions) {
    return `${basePrompt}\n\n${customInstructions}`;
  }

  return basePrompt;
}

