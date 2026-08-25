import type { z } from "zod";
import { Workspace, readFileTool, writeFileTool, editFileTool, listDirTool, globTool } from "./fs.js";
import { grepTool } from "./search.js";
import { bashTool } from "./bash.js";
import { gitStatusTool, gitDiffTool, gitLogTool } from "./git.js";
import { TaskStore, taskCreateTool, taskUpdateTool, taskListTool } from "./tasks.js";
import type { ToolDef } from "../providers/types.js";

export interface AgentTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  schema: z.ZodTypeAny;
  execute(args: any): Promise<string>;
  // Tools that mutate state require permission confirmation before running
  requiresPermission: boolean;
}

export function buildRegistry(ws: Workspace, taskStore = new TaskStore()): Map<string, AgentTool> {
  const tools: AgentTool[] = [
    { ...readFileTool(ws), requiresPermission: false },
    { ...listDirTool(ws), requiresPermission: false },
    { ...globTool(ws), requiresPermission: false },
    { ...grepTool(ws), requiresPermission: false },
    { ...gitStatusTool(ws), requiresPermission: false },
    { ...gitDiffTool(ws), requiresPermission: false },
    { ...gitLogTool(ws), requiresPermission: false },
    { ...taskListTool(taskStore), requiresPermission: false },
    { ...taskCreateTool(taskStore), requiresPermission: false },
    { ...taskUpdateTool(taskStore), requiresPermission: false },
    { ...writeFileTool(ws), requiresPermission: true },
    { ...editFileTool(ws), requiresPermission: true },
    { ...bashTool(ws), requiresPermission: true },
  ];
  return new Map(tools.map((t) => [t.name, t]));
}

export function toToolDefs(registry: Map<string, AgentTool>): ToolDef[] {
  return [...registry.values()].map(({ name, description, parameters }) => ({
    name,
    description,
    parameters,
  }));
}

export async function dispatch(
  registry: Map<string, AgentTool>,
  name: string,
  rawInput: unknown,
): Promise<{ content: string; isError: boolean }> {
  const tool = registry.get(name);
  if (!tool) {
    return {
      content: `Unknown tool "${name}". Available tools: ${[...registry.keys()].join(", ")}`,
      isError: true,
    };
  }

  let parsed;
  try {
    parsed = tool.schema.parse(rawInput);
  } catch (e) {
    if (e instanceof Error && "issues" in e) {
      const details = (e as z.ZodError).issues
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("; ");
      return { content: `Invalid arguments for ${name}: ${details}`, isError: true };
    }
    return { content: `Invalid arguments for ${name}: ${String(e)}`, isError: true };
  }

  try {
    const result = await tool.execute(parsed);
    return { content: result, isError: false };
  } catch (e) {
    return { content: `Error in ${name}: ${e instanceof Error ? e.message : String(e)}`, isError: true };
  }
}
