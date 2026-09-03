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

export interface EvaluatorOptimizerOptions {
  coderPrompt: string;
  evaluatorPrompt?: (codeOutput: string) => string;
  maxIterations?: number;
  isolateWorktree?: boolean;
}

export interface EvaluatorOptimizerResult {
  passed: boolean;
  iterations: number;
  finalOutput: string;
  history: Array<{
    iteration: number;
    coderOutput: string;
    evaluation: string;
    passed: boolean;
  }>;
}

/**
 * Evaluator-Optimizer loop:
 * Runs an implementation agent, evaluates its output with an adversarial reviewer/verifier,
 * and feeds any defects back into the coder until passing or reaching max iterations.
 */
export async function runEvaluatorOptimizer(
  options: EvaluatorOptimizerOptions,
  context: {
    provider: LLMProvider;
    model: string;
    workspaceRoot: string;
    signal?: AbortSignal;
  }
): Promise<EvaluatorOptimizerResult> {
  const maxIterations = options.maxIterations ?? 3;
  let currentCoderPrompt = options.coderPrompt;
  const history: EvaluatorOptimizerResult["history"] = [];
  let finalOutput = "";
  let passed = false;

  for (let iter = 1; iter <= maxIterations; iter++) {
    if (context.signal?.aborted) {
      throw new Error("Evaluator-Optimizer loop aborted by user");
    }

    const coderOutput = await runSubagent({
      role: "coder",
      prompt: currentCoderPrompt,
      provider: context.provider,
      model: context.model,
      workspaceRoot: context.workspaceRoot,
      isolateWorktree: options.isolateWorktree,
      signal: context.signal,
    });

    finalOutput = coderOutput;

    const evalPrompt = options.evaluatorPrompt
      ? options.evaluatorPrompt(coderOutput)
      : `Adversarially evaluate the following implementation. Inspect files/diffs and verify correctness.
Implementation Output:
${coderOutput}

Conclude with either "VERDICT: PASS" if all requirements, edge cases, and tests pass, or "VERDICT: FAIL" followed by a numbered list of specific defects to correct.`;

    const evaluation = await runSubagent({
      role: "reviewer",
      prompt: evalPrompt,
      provider: context.provider,
      model: context.model,
      workspaceRoot: context.workspaceRoot,
      signal: context.signal,
    });

    const isPass = /\b(VERDICT:\s*PASS|PASS)\b/i.test(evaluation) && !/\b(VERDICT:\s*FAIL|FAIL:)\b/i.test(evaluation);

    history.push({
      iteration: iter,
      coderOutput,
      evaluation,
      passed: isPass,
    });

    if (isPass) {
      passed = true;
      break;
    }

    currentCoderPrompt = `${options.coderPrompt}\n\n[Evaluation Feedback - Iteration #${iter} FAILED]:\n${evaluation}\n\nPlease fix the reported defects and ensure all edge cases are addressed.`;
  }

  return {
    passed,
    iterations: history.length,
    finalOutput,
    history,
  };
}

export interface DAGTask {
  id: string;
  role: SubagentOptions["role"];
  promptTemplate: (inputs: Record<string, string>) => string;
  dependsOn?: string[];
  outputSchema?: Record<string, unknown>;
  isolateWorktree?: boolean;
}

export interface DAGWorkflowResult {
  outputs: Record<string, string>;
  errors: Record<string, string>;
}

/**
 * DAG Workflow Runner:
 * Resolves dependencies topologically and runs non-dependent tasks concurrently in waves.
 */
export async function workflowDAG(
  tasks: DAGTask[],
  context: {
    provider: LLMProvider;
    model: string;
    workspaceRoot: string;
    signal?: AbortSignal;
    concurrency?: number;
  }
): Promise<DAGWorkflowResult> {
  const taskMap = new Map<string, DAGTask>();
  const inDegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();

  for (const t of tasks) {
    taskMap.set(t.id, t);
    inDegree.set(t.id, (t.dependsOn ?? []).length);
    for (const dep of t.dependsOn ?? []) {
      const list = dependents.get(dep) ?? [];
      list.push(t.id);
      dependents.set(dep, list);
    }
  }

  const outputs: Record<string, string> = {};
  const errors: Record<string, string> = {};
  const completed = new Set<string>();

  while (completed.size + Object.keys(errors).length < tasks.length) {
    if (context.signal?.aborted) {
      throw new Error("DAG workflow aborted by user");
    }

    // Find all tasks whose dependencies are resolved and haven't been run yet
    const readyTasks: DAGTask[] = [];
    for (const [id, deg] of inDegree.entries()) {
      if (deg === 0 && !completed.has(id) && !errors[id]) {
        const task = taskMap.get(id);
        if (task) readyTasks.push(task);
      }
    }

    if (readyTasks.length === 0) {
      // Circular dependency or unresolvable dead-lock
      for (const [id] of inDegree.entries()) {
        if (!completed.has(id) && !errors[id]) {
          errors[id] = "Unresolvable dependency or cycle detected";
        }
      }
      break;
    }

    // Execute the ready wave concurrently (respecting concurrency limit)
    const concurrency = context.concurrency ?? 4;
    for (let i = 0; i < readyTasks.length; i += concurrency) {
      const batch = readyTasks.slice(i, i + concurrency);
      await Promise.all(
        batch.map(async (task) => {
          // Collect outputs from declared dependencies
          const inputValues: Record<string, string> = {};
          for (const dep of task.dependsOn ?? []) {
            if (errors[dep]) {
              errors[task.id] = `Dependency "${dep}" failed: ${errors[dep]}`;
              return;
            }
            inputValues[dep] = outputs[dep] ?? "";
          }

          try {
            const prompt = task.promptTemplate(inputValues);
            const res = await runSubagent({
              role: task.role,
              prompt,
              provider: context.provider,
              model: context.model,
              workspaceRoot: context.workspaceRoot,
              outputSchema: task.outputSchema,
              isolateWorktree: task.isolateWorktree,
              signal: context.signal,
            });

            outputs[task.id] = res;
            completed.add(task.id);

            // Decrement in-degree for dependents
            for (const depId of dependents.get(task.id) ?? []) {
              const currentDeg = inDegree.get(depId) ?? 1;
              inDegree.set(depId, Math.max(0, currentDeg - 1));
            }
          } catch (err) {
            errors[task.id] = err instanceof Error ? err.message : String(err);
          }
        })
      );
    }
  }

  return { outputs, errors };
}

