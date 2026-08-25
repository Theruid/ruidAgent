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
        maxIterations: {
          type: "number",
          description: "Max iterations for the sub-agent (default 10, max 25)",
        },
      },
      required: ["role", "prompt"],
    },
    schema: z.object({
      role: z.enum(["explore", "coder", "reviewer", "general"]).default("general"),
      prompt: z.string().min(1),
      maxIterations: z.number().int().min(1).max(25).optional().default(10),
    }),
    async execute(args: {
      role: SubagentRole;
      prompt: string;
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
        maxIterations: args.maxIterations ?? 10,
        signal,
      });

      return `[Sub-Agent (${args.role.toUpperCase()}) Result]:\n${result}`;
    },
  };
}
