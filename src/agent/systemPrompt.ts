import { existsSync, readFileSync } from "node:fs";
import * as path from "node:path";
import type { AgentMode } from "../permissions.js";
import type { SystemPromptBlock } from "../providers/types.js";

const INSTRUCTION_FILES = [
  "AGENT.md",
  "CLAUDE.md",
  ".agentrules",
  "RUID.md",
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

export function buildSystemPromptBlocks(
  workspaceRoot: string,
  platform: string,
  mode: AgentMode = "code"
): SystemPromptBlock[] {
  let modeGuideline = "";
  if (mode === "plan") {
    modeGuideline = `<mode_guidelines>
CURRENT MODE: PLAN MODE
- You are in read-only architectural planning mode.
- Do NOT attempt to modify files or run destructive shell commands.
- Use read_file, glob, grep, list_dir, and git_status/git_diff to explore the codebase.
- Use task_create and task_update to establish a clear step-by-step implementation plan.
- Conclude by presenting a comprehensive implementation strategy for user approval.
</mode_guidelines>`;
  } else if (mode === "auto") {
    modeGuideline = `<mode_guidelines>
CURRENT MODE: AUTONOMOUS MODE
- You are in autonomous execution mode. Permissions are pre-granted.
- Make direct, verified changes and run tests to confirm correctness.
</mode_guidelines>`;
  } else {
    modeGuideline = `<mode_guidelines>
CURRENT MODE: CODE MODE
- Focus on focused, safe implementation. Mutating operations prompt for confirmation.
</mode_guidelines>`;
  }

  const staticSystemText = `<system>
You are an expert autonomous software engineering agent. You solve complex engineering tasks, debug code, inspect repositories, and build software.

<guidelines>
- Explore before you act. Use list_dir, glob, grep, and read_file to understand the codebase before making changes.
- Use subagent_spawn to delegate multi-step research, codebase audits, or verification checks to specialized worker agents in parallel.
- For non-trivial or multi-step tasks, use task_create to outline your steps and task_update to mark them in_progress/completed.
- Make focused changes. Fix what was asked; don't refactor unrelated code.
- edit_file requires an exact old_string match — read the file first so you copy text exactly, including indentation.
- Verify your work when possible: run the code or tests after changing them.
- Speak directly to the user in the first person ("I have updated...", "Here are the findings..."). Never output raw internal monologue or speak about the user in the third person.
- If a tool call fails, read the error and adjust rather than repeating the same call.
- Be concise in your final answer: what changed and where.
- File paths in tool arguments are relative to the workspace root.
</guidelines>
</system>`;

  const environmentText = `<environment>
Workspace root: ${workspaceRoot}
Platform: ${platform}
${modeGuideline}
</environment>`;

  const customInstructions = loadProjectInstructions(workspaceRoot);
  const customInstructionsText = customInstructions
    ? `<custom_instructions>\n${customInstructions}\n</custom_instructions>`
    : "";

  return [
    {
      type: "text",
      text: staticSystemText,
      cacheControl: { type: "ephemeral" },
    },
    {
      type: "text",
      text: customInstructionsText ? `${environmentText}\n\n${customInstructionsText}` : environmentText,
    },
  ];
}

export function buildSystemPrompt(
  workspaceRoot: string,
  platform: string,
  mode: AgentMode = "code"
): string {
  const blocks = buildSystemPromptBlocks(workspaceRoot, platform, mode);
  return blocks.map((b) => b.text).join("\n\n");
}
