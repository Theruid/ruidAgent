import type {
  AssistantContent,
  CompletionRequest,
  LLMMessage,
  LLMProvider,
} from "../providers/types.js";
import type { AgentTool } from "../tools/registry.js";
import { buildRegistry, dispatch, toToolDefs } from "../tools/registry.js";
import { Workspace } from "../tools/fs.js";
import { createDeferredPermissions, type PermissionManager } from "../permissions.js";
import { buildSystemPrompt } from "./systemPrompt.js";
import { compactHistory, estimateHistoryTokens } from "./context.js";
import { TaskStore, type AgentTask } from "../tools/tasks.js";

export interface LoopOptions {
  provider: LLMProvider;
  model: string;
  workspaceRoot?: string;
  initialPrompt?: string;
  /** Prior conversation to continue (REPL multi-turn). */
  messages?: LLMMessage[];
  maxIterations?: number;
  permissions?: PermissionManager;
  signal?: AbortSignal;
  onEvent?: (event: LoopEvent) => void;
  maxContextTokens?: number;
  taskStore?: TaskStore;
}

export type LoopEvent =
  | { type: "text_delta"; text: string }
  | { type: "tool_start"; name: string; input?: unknown }
  | { type: "tool_result"; name: string; content: string; isError: boolean }
  | { type: "permission_request"; name: string; input?: unknown }
  | { type: "permission_denied"; name: string }
  | { type: "usage"; inputTokens: number; outputTokens: number; durationMs?: number }
  | { type: "iteration"; count: number }
  | { type: "tasks_updated"; tasks: AgentTask[] };

// Runs the agentic loop to completion and returns the full message history
// so the REPL can continue the conversation across turns.
export async function runAgentLoop(options: LoopOptions): Promise<LLMMessage[]> {
  const ws = new Workspace(options.workspaceRoot ?? process.cwd());
  const taskStore = options.taskStore ?? new TaskStore();
  const registry = buildRegistry(ws, taskStore);
  const permissions =
    options.permissions ??
    createDeferredPermissions(
      new Set([
        "read_file",
        "list_dir",
        "glob",
        "grep",
        "git_status",
        "git_diff",
        "git_log",
        "task_list",
        "task_create",
        "task_update",
      ])
    ).manager;
  const maxIterations = options.maxIterations ?? 40;
  const maxContextTokens = options.maxContextTokens ?? 80_000;

  let messages: LLMMessage[] = [...(options.messages ?? [])];
  if (options.initialPrompt) {
    messages.push({ role: "user", content: [{ type: "text", text: options.initialPrompt }] });
  }

  const systemPrompt = buildSystemPrompt(ws.root, process.platform, permissions.getMode?.() ?? "code");

  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    options.onEvent?.({ type: "iteration", count: iteration });

    // Auto-compact history if estimated tokens exceed safety threshold
    if (estimateHistoryTokens(messages) > maxContextTokens) {
      messages = compactHistory(messages, 4);
    }

    const req: CompletionRequest = {
      system: systemPrompt,
      messages,
      tools: toToolDefs(registry),
      model: options.model,
      signal: options.signal,
    };

    // Accumulate the turn's content while streaming so the exact same blocks
    // go back into history.
    const content: AssistantContent[] = [];
    let textBuffer: { type: "text"; text: string } | null = null;
    const errors: string[] = [];
    const turnStartTime = Date.now();

    try {
      for await (const event of options.provider.complete(req)) {
        switch (event.type) {
          case "text_delta": {
            options.onEvent?.({ type: "text_delta", text: event.text });
            if (!textBuffer) {
              textBuffer = { type: "text", text: "" };
              content.push(textBuffer);
            }
            textBuffer.text += event.text;
            break;
          }
          case "tool_call":
            content.push({ type: "tool_call", id: event.id, name: event.name, input: event.input });
            break;
          case "message_delta":
            if (event.usage) {
              options.onEvent?.({
                type: "usage",
                inputTokens: event.usage.inputTokens,
                outputTokens: event.usage.outputTokens,
                durationMs: Date.now() - turnStartTime,
              });
            }
            break;
          case "error":
            errors.push(event.message);
            break;
        }
      }
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }

    if (errors.length > 0 && content.length === 0) {
      throw new Error(`Provider error: ${errors.join("; ")}`);
    }

    if (content.length === 0) {
      // Empty response — nudge rather than spinning forever.
      messages.push({ role: "assistant", content: [] });
      messages.push({
        role: "user",
        content: [{ type: "text", text: "(empty response — please continue)" }],
      });
      continue;
    }

    messages.push({ role: "assistant", content });

    const toolCalls = content.filter((c) => c.type === "tool_call");
    if (toolCalls.length === 0) break; // final text answer

    const results = [];
    for (const call of toolCalls) {
      if (call.type !== "tool_call") continue;
      const tool: AgentTool | undefined = registry.get(call.name);
      const requiresPermission = tool?.requiresPermission ?? true;

      let approved = true;
      if (requiresPermission) {
        options.onEvent?.({ type: "permission_request", name: call.name, input: call.input });
        approved = await permissions.check(call.name, call.input);
      }

      if (!approved) {
        options.onEvent?.({ type: "permission_denied", name: call.name });
        results.push({
          type: "tool_result" as const,
          toolCallId: call.id,
          content:
            "Permission denied by user. Do not retry this action; inform the user that the operation was cancelled.",
          isError: true,
        });
        continue;
      }

      options.onEvent?.({ type: "tool_start", name: call.name, input: call.input });
      const result = await dispatch(registry, call.name, call.input);

      if (call.name.startsWith("task_")) {
        options.onEvent?.({ type: "tasks_updated", tasks: taskStore.list() });
      }

      options.onEvent?.({
        type: "tool_result",
        name: call.name,
        content: result.content,
        isError: result.isError,
      });
      results.push({
        type: "tool_result" as const,
        toolCallId: call.id,
        content: result.content,
        isError: result.isError,
      });
    }

    messages.push({ role: "user", content: results });

    if (iteration === maxIterations) {
      messages.push({
        role: "user",
        content: [
          { type: "text", text: "(max iterations reached — summarize what was done and stop)" },
        ],
      });
    }
  }

  return messages;
}
