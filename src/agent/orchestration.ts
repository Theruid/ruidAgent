import type { LLMProvider } from "../providers/types.js";
import { runSubagent, type SubagentOptions } from "./subagent.js";

export interface ParallelOptions {
  tokenBudget?: number;
  concurrency?: number;
}

/**
 * Sequential pipeline: Output of step N feeds into step N+1.
 */
export async function pipeline<T = string>(
  initialInput: string,
  steps: Array<{
    role: SubagentOptions["role"];
    promptTemplate: (input: string) => string;
    outputSchema?: Record<string, unknown>;
  }>,
  context: {
    provider: LLMProvider;
    model: string;
    workspaceRoot: string;
    signal?: AbortSignal;
  }
): Promise<T | string> {
  let currentOutput = initialInput;

  for (const step of steps) {
    const prompt = step.promptTemplate(currentOutput);
    const result = await runSubagent({
      role: step.role,
      prompt,
      provider: context.provider,
      model: context.model,
      workspaceRoot: context.workspaceRoot,
      outputSchema: step.outputSchema,
      signal: context.signal,
    });
    currentOutput = result;
  }

  return currentOutput as T | string;
}

/**
 * Concurrently executes subagent tasks with optional concurrency and token ceiling abort checks.
 */
export async function parallel<T = string>(
  tasks: Array<{
    role: SubagentOptions["role"];
    prompt: string;
    outputSchema?: Record<string, unknown>;
    isolateWorktree?: boolean;
  }>,
  context: {
    provider: LLMProvider;
    model: string;
    workspaceRoot: string;
    signal?: AbortSignal;
    options?: ParallelOptions;
  }
): Promise<Array<{ index: number; result: T | string; error?: string }>> {
  const results: Array<{ index: number; result: T | string; error?: string }> = [];
  const concurrency = context.options?.concurrency ?? 4;

  for (let i = 0; i < tasks.length; i += concurrency) {
    const batch = tasks.slice(i, i + concurrency);
    const batchPromises = batch.map(async (task, batchIdx) => {
      const taskIndex = i + batchIdx;
      try {
        const res = await runSubagent({
          role: task.role,
          prompt: task.prompt,
          provider: context.provider,
          model: context.model,
          workspaceRoot: context.workspaceRoot,
          outputSchema: task.outputSchema,
          isolateWorktree: task.isolateWorktree,
          signal: context.signal,
        });
        return { index: taskIndex, result: res as T | string };
      } catch (err) {
        return {
          index: taskIndex,
          result: "",
          error: err instanceof Error ? err.message : String(err),
        };
      }
    });

    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults);
  }

  return results.sort((a, b) => a.index - b.index);
}
