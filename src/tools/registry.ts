import { z } from "zod";
import { Workspace, readFileTool, writeFileTool, editFileTool, listDirTool, globTool } from "./fs.js";
import { grepTool } from "./search.js";
import { bashTool, ProcessManager, processStatusTool, processLogsTool, processKillTool } from "./bash.js";
import { gitStatusTool, gitDiffTool, gitLogTool } from "./git.js";
import { TaskStore, taskCreateTool, taskUpdateTool, taskListTool } from "./tasks.js";
import { SnapshotManager, rollbackTool } from "./snapshot.js";
import { subagentTool } from "./subagent.js";
import type { ToolDef, LLMProvider } from "../providers/types.js";
import type { MCPClient } from "../mcp/client.js";

export interface AgentTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  schema: z.ZodTypeAny;
  execute(args: any): Promise<string>;
  // Tools that mutate state require permission confirmation before running
  requiresPermission: boolean;
}

export function buildRegistry(
  ws: Workspace,
  taskStore = new TaskStore(),
  snapshots = new SnapshotManager(),
  provider?: LLMProvider,
  model?: string,
  signal?: AbortSignal,
  processManager = new ProcessManager(),
  onBashChunk?: (chunk: string, stream: "stdout" | "stderr") => void,
  mcpClients: MCPClient[] = []
): Map<string, AgentTool> {
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
    { ...processStatusTool(processManager), requiresPermission: false },
    { ...processLogsTool(processManager), requiresPermission: false },
    { ...processKillTool(processManager), requiresPermission: true },
    { ...rollbackTool(ws, snapshots), requiresPermission: false },
    ...(provider && model ? [{ ...subagentTool(ws, provider, model, signal), requiresPermission: false }] : []),
    { ...writeFileTool(ws, snapshots), requiresPermission: true },
    { ...editFileTool(ws, snapshots), requiresPermission: true },
    { ...bashTool(ws, processManager, onBashChunk), requiresPermission: true },
  ];

  const registry = new Map(tools.map((t) => [t.name, t]));

  // Dynamically attach MCP tools
  for (const client of mcpClients) {
    client.listTools().then((mcpTools) => {
      for (const mcpTool of mcpTools) {
        const namespacedName = `mcp__${client.serverName}__${mcpTool.name}`;
        registry.set(namespacedName, {
          name: namespacedName,
          description: mcpTool.description || `MCP tool from ${client.serverName}`,
          parameters: mcpTool.inputSchema ?? { type: "object", properties: {} },
          schema: z.record(z.unknown()).optional(),
          execute: async (args: any) => {
            const res = await client.callTool(mcpTool.name, args);
            if (res.isError) throw new Error(res.content);
            return res.content;
          },
          requiresPermission: !client.config.trusted, // Untrusted by default
        });
      }
    }).catch(() => {});
  }

  return registry;
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
