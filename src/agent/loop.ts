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
import { buildSystemPromptBlocks } from "./systemPrompt.js";
import { microCompactHistory, semanticSummarizeHistory, estimateHistoryTokens } from "./context.js";
import { TaskStore, type AgentTask } from "../tools/tasks.js";
import { SnapshotManager } from "../tools/snapshot.js";
import { ProcessManager } from "../tools/bash.js";
import { logAudit } from "../audit/log.js";
import type { MCPClient } from "../mcp/client.js";

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
  snapshots?: SnapshotManager;
  processManager?: ProcessManager;
  mcpClients?: MCPClient[];
}

export type LoopEvent =
  | { type: "text_delta"; text: string }
  | { type: "thought_delta"; text: string }
  | { type: "tool_start"; name: string; input?: unknown }
  | { type: "tool_result"; name: string; content: string; isError: boolean }
  | { type: "permission_request"; name: string; input?: unknown }
  | { type: "permission_denied"; name: string }
  | {
      type: "usage";
      inputTokens: number;
      outputTokens: number;
      cacheCreationInputTokens?: number;
      cacheReadInputTokens?: number;
      durationMs?: number;
    }
  | { type: "iteration"; count: number }
  | { type: "tasks_updated"; tasks: AgentTask[] };

export type FailureClassification = "transient" | "permanent" | "stale_state";

const STALE_STATE_SIGNATURES = [
  /old_string not found/i,
  /resource changed since last read/i,
  /conflicting version/i,
  /file modified concurrently/i,
  /target text does not match/i,
];

export function classifyToolFailure(errorMessage: string): FailureClassification {
  for (const sig of STALE_STATE_SIGNATURES) {
    if (sig.test(errorMessage)) {
      return "stale_state";
    }
  }
  return "transient";
}

interface StaleStateTrack {
  toolName: string;
  inputJson: string;
  targetPath?: string;
  forcedReadDone: boolean;
  retriedOnce: boolean;
}

// Runs the agentic loop to completion and returns the full message history
// so the REPL can continue the conversation across turns.
export async function runAgentLoop(options: LoopOptions): Promise<LLMMessage[]> {
  const ws = new Workspace(options.workspaceRoot ?? process.cwd());
  const taskStore = options.taskStore ?? new TaskStore();
  const snapshots = options.snapshots ?? new SnapshotManager();
  const processManager = options.processManager ?? new ProcessManager();
  snapshots.beginTurn();

  const registry = await buildRegistry(
    ws,
    taskStore,
    snapshots,
    options.provider,
    options.model,
    options.signal,
    processManager,
    undefined,
    options.mcpClients ?? []
  );

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
        "rollback",
        "subagent_spawn",
        "process_status",
        "process_logs",
      ])
    ).manager;

  const maxIterations = options.maxIterations ?? 40;
  const maxContextTokens = options.maxContextTokens ?? 80_000;

  let messages: LLMMessage[] = [...(options.messages ?? [])];
  if (options.initialPrompt) {
    messages.push({ role: "user", content: [{ type: "text", text: options.initialPrompt }] });
  }

  const systemBlocks = buildSystemPromptBlocks(ws.root, process.platform, permissions.getMode?.() ?? "code");

  // Track active stale_state failures per resource path
  const staleStateMap = new Map<string, StaleStateTrack>();

  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    options.onEvent?.({ type: "iteration", count: iteration });

    const tokenEstimate = estimateHistoryTokens(messages);

    // Two-phase history compaction:
    // Phase 1 (Micro-compaction at 70% threshold)
    if (tokenEstimate > maxContextTokens * 0.7 && tokenEstimate <= maxContextTokens * 0.85) {
      messages = microCompactHistory(messages, 4);
    }
    // Phase 2 (Semantic LLM Summarization at 85% threshold)
    else if (tokenEstimate > maxContextTokens * 0.85) {
      messages = await semanticSummarizeHistory(messages, options.provider, options.model, 4, options.signal);
    }

    const req: CompletionRequest = {
      system: systemBlocks,
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
          case "thought_delta": {
            options.onEvent?.({ type: "thought_delta", text: event.text });
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
                cacheCreationInputTokens: event.usage.cacheCreationInputTokens,
                cacheReadInputTokens: event.usage.cacheReadInputTokens,
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

    const toolCalls = content.filter((c): c is Extract<typeof c, { type: "tool_call" }> => c.type === "tool_call");
    if (toolCalls.length === 0) break; // final text answer

    // Phase 1: resolve permissions sequentially
    const approvals: boolean[] = [];
    for (const call of toolCalls) {
      const tool: AgentTool | undefined = registry.get(call.name);
      const requiresPermission = tool?.requiresPermission ?? true;

      if (!requiresPermission) {
        approvals.push(true);
        continue;
      }
      options.onEvent?.({ type: "permission_request", name: call.name, input: call.input });
      approvals.push(await permissions.check(call.name, call.input));
    }

    // Phase 2: dispatch all approved work simultaneously
    const results = await Promise.all(
      toolCalls.map(async (call, i) => {
        if (!approvals[i]) {
          options.onEvent?.({ type: "permission_denied", name: call.name });
          return {
            type: "tool_result" as const,
            toolCallId: call.id,
            content:
              "Permission denied by user. Do not retry this action; inform the user that the operation was cancelled.",
            isError: true,
          };
        }

        const rawInputJson = JSON.stringify(call.input ?? {});
        const targetPath = (call.input as any)?.path as string | undefined;
        const trackKey = targetPath ?? call.name;
        const track = staleStateMap.get(trackKey);

        // Check if model is repeating identical failed arguments without re-reading
        if (track && rawInputJson === track.inputJson && !track.forcedReadDone) {
          logAudit({
            ts: Date.now(),
            source: "direct",
            tool: call.name,
            args: call.input,
            tier: permissions.classifyRisk?.(call.name, call.input) ?? 1,
            decision: "denied",
            error: "Blocked identical retry before state re-verification",
          });

          return {
            type: "tool_result" as const,
            toolCallId: call.id,
            content: `Error: Stale state retry blocked. You must inspect/read '${trackKey}' first before submitting edits.`,
            isError: true,
          };
        }

        // If this is a read tool on a tracked stale resource, mark forcedReadDone
        if (track && (call.name === "read_file" || call.name === "git_diff") && targetPath === track.targetPath) {
          track.forcedReadDone = true;
        }

        options.onEvent?.({ type: "tool_start", name: call.name, input: call.input });
        const result = await dispatch(registry, call.name, call.input);

        // Classify tool result
        if (result.isError) {
          const failureClass = classifyToolFailure(result.content);

          if (failureClass === "stale_state") {
            if (!track) {
              // First stale state failure: force state re-verification and allow one retry
              staleStateMap.set(trackKey, {
                toolName: call.name,
                inputJson: rawInputJson,
                targetPath,
                forcedReadDone: false,
                retriedOnce: false,
              });

              logAudit({
                ts: Date.now(),
                source: "direct",
                tool: call.name,
                args: call.input,
                tier: permissions.classifyRisk?.(call.name, call.input) ?? 1,
                decision: "allowed",
                resultSummary: "stale_state failure registered; forcing re-read",
                isError: true,
                error: result.content,
              });

              // Inject fresh resource inspection prompt into result
              let freshReadPrompt = "";
              if (targetPath && call.name === "edit_file") {
                try {
                  const freshContent = await registry.get("read_file")?.execute({ path: targetPath });
                  if (freshContent) {
                    trackKey && staleStateMap.get(trackKey) && (staleStateMap.get(trackKey)!.forcedReadDone = true);
                    freshReadPrompt = `\n\n[Forced Fresh State of ${targetPath}]:\n${freshContent}\n\nPlease update your old_string using this exact fresh content.`;

                    logAudit({
                      ts: Date.now(),
                      source: "direct",
                      tool: "read_file",
                      args: { path: targetPath },
                      tier: 0,
                      decision: "auto_approved",
                      resultSummary: `Forced re-read for stale state on ${targetPath}`,
                    });
                  }
                } catch {}
              }

              result.content = `${result.content}${freshReadPrompt}`;
            } else if (track.retriedOnce || (rawInputJson !== track.inputJson && track.forcedReadDone)) {
              // Failed again even after forced re-read -> escalate to permanent
              staleStateMap.delete(trackKey);
              logAudit({
                ts: Date.now(),
                source: "direct",
                tool: call.name,
                args: call.input,
                tier: permissions.classifyRisk?.(call.name, call.input) ?? 1,
                decision: "allowed",
                resultSummary: "stale_state escalated to permanent failure after retry",
                isError: true,
                error: result.content,
              });
              result.content = `[Permanent Failure]: ${result.content}\nAction aborted after state re-verification. Do not retry this edit automatically.`;
            }
          }
        } else {
          // Successful tool call clears stale tracking for this resource
          if (track) {
            logAudit({
              ts: Date.now(),
              source: "direct",
              tool: call.name,
              args: call.input,
              tier: permissions.classifyRisk?.(call.name, call.input) ?? 1,
              decision: "allowed",
              resultSummary: `Retry succeeded on ${trackKey} after fresh state verification`,
            });
            staleStateMap.delete(trackKey);
          }
        }

        if (call.name.startsWith("task_")) {
          options.onEvent?.({ type: "tasks_updated", tasks: taskStore.list() });
        }

        options.onEvent?.({
          type: "tool_result",
          name: call.name,
          content: result.content,
          isError: result.isError,
        });

        return {
          type: "tool_result" as const,
          toolCallId: call.id,
          content: result.content,
          isError: result.isError,
        };
      })
    );

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
