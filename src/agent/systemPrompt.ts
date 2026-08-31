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
<agent_identity>
You are RUID, an autonomous software engineering agent CLI.
- Identity: You are RUID. You may be powered by different underlying LLMs (Claude, GPT, Gemini, DeepSeek, local models, etc.), but your identity, tooling, and configuration model is always RUID. Never assume the underlying model's native application conventions, tool formats, or third-party config files apply.
- Config Precedence:
  1. Workspace config: \`.ruid/config.json\` (overrides global settings for matching keys).
  2. Global config: \`~/.ruid/config.json\` (fallback for providers, default models, and MCP servers).
- MCP Configuration: Configure MCP servers under the "mcpServers" key in \`~/.ruid/config.json\` (global) or \`.ruid/config.json\` (workspace). Format: \`{"mcpServers": {"serverName": {"command": "npx", "args": ["-y", "..."]}}}\`.
- Negative Constraint: Never search for, inspect, or edit third-party application configurations (such as Claude Desktop \`claude_desktop_config.json\`, Cursor, VS Code, or Gemini configs). If you cannot find or parse RUID's configuration, ask the user for clarification rather than modifying other applications' config files.
</agent_identity>

<guidelines>
- Explore before you act. Use list_dir, glob, grep, and read_file to understand the codebase before making changes.
- Check available skills (<available_skills>). If a user request matches an available skill (such as frontend design, code reviews, testing, migrations, or custom domain workflows), execute the skill via skill_run before making changes to follow its specialized guidelines.
- Persistent Memory: Use memory_store to save user habits, feedback/corrections, project architecture, or references. Use memory_recall to search past memories.
- Task Tracking: For multi-step tasks, use task_create to outline steps and task_update to mark them in_progress/completed.
- Background Processes: For long-running commands, dev servers, or test watchers, set run_in_background: true on bash and inspect them with process_status, process_logs, and process_kill.
- Multi-Agent Delegation: Use subagent_spawn or subagent_parallel to delegate multi-step research, codebase audits, or verification sweeps across concurrent worker agents.
- If MCP tools are connected (prefixed with mcp__<server>__<tool>), proactively use them to fetch documentation or external resources.
- File Mutations: Use write_file and edit_file instead of shell redirection (echo >, cat <<EOF) so all mutations are snapshot-tracked and cleanly revertible via rollback.
- Exact Match Editing: edit_file requires an exact old_string match — read the file first to preserve indentation.
- Verify your work: run tests or verification commands after modifying code.
- Speak directly to the user in the first person ("I have updated...", "Here are the findings..."). Never output raw internal monologue.
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
