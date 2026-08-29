import { existsSync, readFileSync } from "node:fs";
import * as path from "node:path";
import type { AgentMode } from "../permissions.js";
import type { SystemPromptBlock } from "../providers/types.js";

const INSTRUCTION_FILES = [
  "RUID.md",
  "AGENT.md",
  ".agentrules",
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

export interface SystemPromptContext {
  workspaceRoot: string;
  platform: string;
  mode?: AgentMode;
  memorySummary?: string | null;
  skillsListing?: string | null;
}

export function buildSystemPromptBlocks(
  workspaceRootOrContext: string | SystemPromptContext,
  platformArg?: string,
  modeArg: AgentMode = "code"
): SystemPromptBlock[] {
  let workspaceRoot: string;
  let platform: string;
  let mode: AgentMode;
  let memorySummary: string | null = null;
  let skillsListing: string | null = null;

  if (typeof workspaceRootOrContext === "object") {
    workspaceRoot = workspaceRootOrContext.workspaceRoot;
    platform = workspaceRootOrContext.platform;
    mode = workspaceRootOrContext.mode ?? "code";
    memorySummary = workspaceRootOrContext.memorySummary ?? null;
    skillsListing = workspaceRootOrContext.skillsListing ?? null;
  } else {
    workspaceRoot = workspaceRootOrContext;
    platform = platformArg ?? process.platform;
    mode = modeArg;
  }
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
- You are in autonomous execution mode. Standard permissions are pre-granted for rapid execution.
- Note: Tier-4 sensitive file operations (.env, credentials, SSH keys, destructive rm -rf) still require explicit user confirmation.
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
- Use write_file, edit_file, and make_dir for all file and directory creations/edits instead of shell commands (mkdir, touch, cp, echo >). This ensures all changes are tracked by turn snapshots and can be cleanly reverted with rollback.
- Use web_search to search the live web for up-to-date documentation, APIs, error messages, and package releases.
- Use web_fetch to read full remote documentation pages, specifications, or GitHub issues as clean Markdown.
- Use subagent_spawn or subagent_parallel to delegate multi-step research, codebase audits, or verification sweeps across concurrent worker agents.
- If MCP tools are connected (prefixed with mcp__<server>__<tool>, e.g. context7 or memory), proactively use them to fetch up-to-date documentation or external resources.
- For long-running commands, dev servers, or test watchers, set run_in_background: true on bash and inspect them with process_status, process_logs, and process_kill.
- If an unintentional modification occurs, use rollback to restore files back to the previous turn snapshot state.
- For non-trivial or multi-step tasks, use task_create to outline your steps and task_update to mark them in_progress/completed.
- Make focused changes. Fix what was asked; don't refactor unrelated code.
- edit_file requires an exact old_string match — read the file first so you copy text exactly, including indentation. If an edit fails due to stale state, re-read the file before retrying.
- Verify your work: run the code or automated tests after making changes.
- Speak directly to the user in the first person ("I have updated...", "Here are the findings..."). Never output raw internal monologue or speak about the user in the third person.
- Be concise in your final answer: state what changed and where.
- File paths in tool arguments are relative to the workspace root.
</guidelines>
</system>`;

  const environmentText = `<environment>
Workspace root: ${workspaceRoot}
Platform: ${platform}
Shell: ${platform === "win32" ? "bash (Git Bash / POSIX syntax supported via -c)" : "sh (/bin/sh)"}
${modeGuideline}
</environment>`;

  const customInstructions = loadProjectInstructions(workspaceRoot);
  const customInstructionsText = customInstructions
    ? `<custom_instructions>\n${customInstructions}\n</custom_instructions>`
    : "";

  const memoryBlockText = memorySummary
    ? `<memory>\n${memorySummary}\n</memory>`
    : "";

  const skillsBlockText = skillsListing ? `${skillsListing}` : "";

  const dynamicSections = [
    environmentText,
    memoryBlockText,
    skillsBlockText,
    customInstructionsText,
  ]
    .filter(Boolean)
    .join("\n\n");

  return [
    {
      type: "text",
      text: staticSystemText,
      cacheControl: { type: "ephemeral" },
    },
    {
      type: "text",
      text: dynamicSections,
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
