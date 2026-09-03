import type { LLMProvider, LLMMessage } from "../providers/types.js";
import { runAgentLoop, type LoopEvent } from "./loop.js";
import { Workspace } from "../tools/fs.js";
import { createDeferredPermissions } from "../permissions.js";
import { createWorktree } from "./worktree.js";

export type SubagentRole = "explore" | "coder" | "reviewer" | "general";

export interface SubagentOptions {
  role: SubagentRole;
  prompt: string;
  provider: LLMProvider;
  model: string;
  workspaceRoot?: string;
  maxIterations?: number;
  outputSchema?: Record<string, unknown>;
  isolateWorktree?: boolean;
  onProgress?: (text: string) => void;
  onEvent?: (event: LoopEvent) => void;
  signal?: AbortSignal;
}

export function buildSubagentSystemPrompt(
  role: SubagentRole,
  workspaceRoot: string,
  platform: string,
  outputSchema?: Record<string, unknown>,
  isNativeStructuredOutput = false
): string {
  const baseHeader = `You are a specialized sub-agent [ROLE: ${role.toUpperCase()}] working in ${workspaceRoot} on ${platform}.
Your mission is to perform a focused task delegated by the main orchestrator agent.
Be thorough in tool usage, and concise in your final output. Return ONLY the direct findings/results without filler.`;

  let schemaInstructions = "";
  if (outputSchema && !isNativeStructuredOutput) {
    schemaInstructions = `\n\n<structured_output_requirement>
You MUST return your final result conforming to this JSON Schema:
${JSON.stringify(outputSchema, null, 2)}
Conclude by outputting ONLY the validated JSON object.
</structured_output_requirement>`;
  }

  switch (role) {
    case "explore":
      return `${baseHeader}

Role Guidelines:
- You are a read-only research specialist.
- Use read_file, glob, grep, list_dir, web_search, web_fetch, git_status, and git_log to investigate code, find definitions, lookup docs, and trace dependencies.
- Do not attempt to modify files.
- Summarize your exact findings, file paths, line numbers, and patterns discovered.${schemaInstructions}`;

    case "reviewer":
      return `${baseHeader}

Role Guidelines:
- You are an adversarial code reviewer and verification specialist.
- Inspect changes via git_diff, check modified files, and run tests or linters via bash if needed.
- Report any syntax issues, bugs, regressions, or test failures clearly.${schemaInstructions}`;

    case "coder":
      return `${baseHeader}

Role Guidelines:
- You are an implementation specialist.
- Read files carefully before modifying them with edit_file or write_file.
- Make focused, precise edits and verify changes when done.${schemaInstructions}`;

    case "general":
    default:
      return `${baseHeader}

Role Guidelines:
- Accomplish the task using all available tools and provide a clear final summary.${schemaInstructions}`;
  }
}

/**
 * Executes a sub-agent in an isolated context loop (and optional git worktree).
 * Returns the final synthesized answer from the sub-agent.
 */
export async function runSubagent(opts: SubagentOptions): Promise<string> {
  const baseRoot = opts.workspaceRoot ?? process.cwd();
  let activeRoot = baseRoot;
  let worktree;

  if (opts.isolateWorktree) {
    try {
      worktree = await createWorktree(baseRoot);
      activeRoot = worktree.path;
    } catch {
      // If worktree creation fails (e.g. not a git repo), proceed in main workspace root
    }
  }

  const ws = new Workspace(activeRoot);
  const maxIterations = opts.maxIterations ?? 12;
  const caps = opts.provider.capabilities
    ? opts.provider.capabilities(opts.model)
    : { supportsStructuredOutput: false, supportsThinking: false };

  const isNativeStructured = Boolean(opts.outputSchema && caps.supportsStructuredOutput);
  const initialSystemPrompt = buildSubagentSystemPrompt(
    opts.role,
    ws.root,
    process.platform,
    opts.outputSchema,
    isNativeStructured
  );

  const permissions = createDeferredPermissions(
    new Set([
      "read_file",
      "list_dir",
      "glob",
      "grep",
      "git_status",
      "git_diff",
      "git_log",
      "write_file",
      "edit_file",
      "bash",
      "task_list",
      "task_create",
      "task_update",
    ]),
    opts.role === "explore" ? "plan" : "auto"
  );

  let finalAnswer = "";
  const events: LoopEvent[] = [];

  try {
    const history: LLMMessage[] = await runAgentLoop({
      provider: opts.provider,
      model: opts.model,
      workspaceRoot: ws.root,
      initialPrompt: opts.prompt,
      maxIterations,
      permissions: permissions.manager,
      signal: opts.signal,
      onEvent: (event) => {
        events.push(event);
        opts.onEvent?.(event);
        if (event.type === "text_delta") {
          opts.onProgress?.(event.text);
        }
      },
    });

    // Extract the assistant's final text answer from history
    for (let i = history.length - 1; i >= 0; i--) {
      const msg = history[i];
      if (msg.role === "assistant") {
        const textBlocks = msg.content.filter((c): c is Extract<typeof c, { type: "text" }> => c.type === "text");
        if (textBlocks.length > 0) {
          finalAnswer = textBlocks.map((b) => b.text).join("\n").trim();
          break;
        }
      }
    }
  } finally {
    if (worktree) {
      await worktree.cleanup();
    }
  }

  return finalAnswer || "Sub-agent finished with no text output.";
}
