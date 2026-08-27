import { z } from "zod";
import type { Workspace } from "./fs.js";
import type { LLMProvider } from "../providers/types.js";
import { runSubagent, type SubagentRole } from "../agent/subagent.js";

export function subagentTool(
  ws: Workspace,
  provider: LLMProvider,
  model: string,
  signal?: AbortSignal
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
      });

      return `[Sub-Agent (${args.role.toUpperCase()}) Result]:\n${result}`;
    },
  };
}
