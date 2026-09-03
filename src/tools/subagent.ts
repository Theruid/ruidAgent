import { z } from "zod";
import type { Workspace } from "./fs.js";
import type { LLMProvider } from "../providers/types.js";
import { runSubagent, type SubagentRole } from "../agent/subagent.js";
import { parallel } from "../agent/orchestration.js";
import type { LoopEvent } from "../agent/loop.js";

export function subagentTool(
  ws: Workspace,
  provider: LLMProvider,
  model: string,
  signal?: AbortSignal,
  onEvent?: (event: LoopEvent) => void
) {
  return {
    name: "subagent_spawn",
    description:
      "Delegate a complex task or research question to an isolated specialist sub-agent. The sub-agent runs its own private tool loop without bloating the parent conversation context, returning its final findings/results.",
    parameters: {
      type: "object",
      properties: {
        role: {
          type: "string",
          enum: ["explore", "coder", "reviewer", "general"],
          description:
            "Specialist role: 'explore' (fast read-only code search), 'coder' (isolated file implementation), 'reviewer' (verification & tests), 'general' (multi-purpose)",
        },
        prompt: {
          type: "string",
          description: "Detailed, self-contained prompt describing the delegated task and expected return output",
        },
        output_schema: {
          type: "object",
          description: "Optional JSON Schema that the sub-agent MUST conform its return output to",
        },
        isolate_worktree: {
          type: "boolean",
          description: "Run modifying subagent inside an isolated git worktree (default false)",
        },
        maxIterations: {
          type: "number",
          description: "Max iterations for the sub-agent (default 12, max 30)",
        },
      },
      required: ["role", "prompt"],
    },
    schema: z.object({
      role: z.enum(["explore", "coder", "reviewer", "general"]).default("general"),
      prompt: z.string().min(1),
      output_schema: z.record(z.unknown()).optional(),
      isolate_worktree: z.boolean().optional().default(false),
      maxIterations: z.number().int().min(1).max(30).optional().default(12),
    }),
    async execute(args: {
      role: SubagentRole;
      prompt: string;
      output_schema?: Record<string, unknown>;
      isolate_worktree?: boolean;
      maxIterations?: number;
    }): Promise<string> {
      if (signal?.aborted) {
        throw new Error("Sub-agent aborted by user");
      }

      const result = await runSubagent({
        role: args.role,
        prompt: args.prompt,
        provider,
        model,
        workspaceRoot: ws.root,
        outputSchema: args.output_schema,
        isolateWorktree: args.isolate_worktree,
        maxIterations: args.maxIterations ?? 12,
        signal,
        onEvent,
      });

      return `[Sub-Agent (${args.role.toUpperCase()}) Result]:\n${result}`;
    },
  };
}

export function subagentParallelTool(
  ws: Workspace,
  provider: LLMProvider,
  model: string,
  signal?: AbortSignal
) {
  return {
    name: "subagent_parallel",
    description:
      "Execute multiple specialist sub-agents concurrently in parallel. Useful for fanning out codebase audits, reviewing multiple independent modules, or verifying test suites simultaneously.",
    parameters: {
      type: "object",
      properties: {
        tasks: {
          type: "array",
          items: {
            type: "object",
            properties: {
              role: {
                type: "string",
                enum: ["explore", "coder", "reviewer", "general"],
                description: "Specialist role",
              },
              prompt: {
                type: "string",
                description: "Task instructions for this sub-agent",
              },
              output_schema: {
                type: "object",
                description: "Optional JSON Schema",
              },
              isolate_worktree: {
                type: "boolean",
                description: "Run in isolated git worktree",
              },
            },
            required: ["role", "prompt"],
          },
          description: "List of tasks to execute in parallel (max 10)",
        },
        concurrency: {
          type: "number",
          description: "Max concurrent workers (default 4)",
        },
      },
      required: ["tasks"],
    },
    schema: z.object({
      tasks: z.array(
        z.object({
          role: z.enum(["explore", "coder", "reviewer", "general"]).default("general"),
          prompt: z.string().min(1),
          output_schema: z.record(z.unknown()).optional(),
          isolate_worktree: z.boolean().optional().default(false),
        })
      ).min(1).max(10),
      concurrency: z.number().int().min(1).max(10).optional().default(4),
    }),
    async execute(args: {
      tasks: Array<{
        role: SubagentRole;
        prompt: string;
        output_schema?: Record<string, unknown>;
        isolate_worktree?: boolean;
      }>;
      concurrency?: number;
    }): Promise<string> {
      if (signal?.aborted) {
        throw new Error("Parallel sub-agents aborted by user");
      }

      const results = await parallel(args.tasks, {
        provider,
        model,
        workspaceRoot: ws.root,
        signal,
        options: { concurrency: args.concurrency ?? 4 },
      });

      const outputLines: string[] = [];
      for (const res of results) {
        if (res.error) {
          outputLines.push(`[Task #${res.index + 1} (${args.tasks[res.index].role.toUpperCase()}) Failed]: ${res.error}`);
        } else {
          outputLines.push(`[Task #${res.index + 1} (${args.tasks[res.index].role.toUpperCase()}) Result]:\n${res.result}`);
        }
      }

      return outputLines.join("\n\n---\n\n");
    },
  };
}
