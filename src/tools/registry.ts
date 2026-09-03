import { z } from "zod";
import { Workspace, readFileTool, writeFileTool, editFileTool, listDirTool, globTool } from "./fs.js";
import { grepTool } from "./search.js";
import { bashTool, ProcessManager, processStatusTool, processLogsTool, processKillTool } from "./bash.js";
import { gitStatusTool, gitDiffTool, gitLogTool } from "./git.js";
import { TaskStore, taskCreateTool, taskUpdateTool, taskDeleteTool, taskListTool } from "./tasks.js";
import { SnapshotManager, rollbackTool } from "./snapshot.js";
import { GitCheckpointManager, gitRollbackTool } from "./gitRollback.js";
import { subagentTool, subagentParallelTool, subagentOptimizeTool, subagentWorkflowTool } from "./subagent.js";
import { webSearchTool, webFetchTool } from "./web.js";
import { memoryStoreTool, memoryRecallTool, memoryListTool, memoryForgetTool } from "./memory.js";
import { skillRunTool } from "./skill.js";
import type { MemoryManager } from "../memory/manager.js";
import type { SkillManager } from "../skills/loader.js";
import type { ToolDef, LLMProvider } from "../providers/types.js";
import type { MCPClient } from "../mcp/client.js";
import type { LoopEvent } from "../agent/loop.js";

export interface AgentTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  schema: z.ZodTypeAny;
  execute(args: any): Promise<string>;
  // Tools that mutate state require permission confirmation before running
  requiresPermission: boolean;
}

export interface BuildRegistryOptions {
  workspace: Workspace;
  taskStore?: TaskStore;
  snapshots?: SnapshotManager;
  gitCheckpoints?: GitCheckpointManager;
  memoryManager?: MemoryManager;
  skillManager?: SkillManager;
  provider?: LLMProvider;
  model?: string;
  signal?: AbortSignal;
  processManager?: ProcessManager;
  onBashChunk?: (chunk: string, stream: "stdout" | "stderr") => void;
  onSubagentEvent?: (event: LoopEvent) => void;
  mcpClients?: MCPClient[];
}

export async function buildRegistry(
  optionsOrWs: Workspace | BuildRegistryOptions,
  taskStoreArg = new TaskStore(),
  snapshotsArg = new SnapshotManager(),
  providerArg?: LLMProvider,
  modelArg?: string,
  signalArg?: AbortSignal,
  processManagerArg = new ProcessManager(),
  onBashChunkArg?: (chunk: string, stream: "stdout" | "stderr") => void,
  mcpClientsArg: MCPClient[] = [],
  gitCheckpointsArg?: GitCheckpointManager
): Promise<Map<string, AgentTool>> {
  let ws: Workspace;
  let taskStore: TaskStore;
  let snapshots: SnapshotManager;
  let gitCheckpoints: GitCheckpointManager | undefined;
  let memoryManager: MemoryManager | undefined;
  let skillManager: SkillManager | undefined;
  let provider: LLMProvider | undefined;
  let model: string | undefined;
  let signal: AbortSignal | undefined;
  let processManager: ProcessManager;
  let onBashChunk: ((chunk: string, stream: "stdout" | "stderr") => void) | undefined;
  let onSubagentEvent: ((event: LoopEvent) => void) | undefined;
  let mcpClients: MCPClient[];

  if ("workspace" in optionsOrWs) {
    ws = optionsOrWs.workspace;
    taskStore = optionsOrWs.taskStore ?? new TaskStore();
    snapshots = optionsOrWs.snapshots ?? new SnapshotManager();
    gitCheckpoints = optionsOrWs.gitCheckpoints;
    memoryManager = optionsOrWs.memoryManager;
    skillManager = optionsOrWs.skillManager;
    provider = optionsOrWs.provider;
    model = optionsOrWs.model;
    signal = optionsOrWs.signal;
    processManager = optionsOrWs.processManager ?? new ProcessManager();
    onBashChunk = optionsOrWs.onBashChunk;
    onSubagentEvent = optionsOrWs.onSubagentEvent;
    mcpClients = optionsOrWs.mcpClients ?? [];
  } else {
    ws = optionsOrWs;
    taskStore = taskStoreArg;
    snapshots = snapshotsArg;
    gitCheckpoints = gitCheckpointsArg;
    provider = providerArg;
    model = modelArg;
    signal = signalArg;
    processManager = processManagerArg;
    onBashChunk = onBashChunkArg;
    mcpClients = mcpClientsArg;
  }
  const tools: AgentTool[] = [
    { ...readFileTool(ws), requiresPermission: false },
    { ...listDirTool(ws), requiresPermission: false },
    { ...globTool(ws), requiresPermission: false },
    { ...grepTool(ws), requiresPermission: false },
    { ...webSearchTool(signal), requiresPermission: false },
    { ...webFetchTool(signal), requiresPermission: false },
    { ...gitStatusTool(ws), requiresPermission: false },
    { ...gitDiffTool(ws), requiresPermission: false },
    { ...gitLogTool(ws), requiresPermission: false },
    { ...taskListTool(taskStore), requiresPermission: false },
    { ...taskCreateTool(taskStore), requiresPermission: false },
    { ...taskUpdateTool(taskStore), requiresPermission: false },
    { ...taskDeleteTool(taskStore), requiresPermission: false },
    ...(memoryManager
      ? [
          { ...memoryStoreTool(memoryManager), requiresPermission: false },
          { ...memoryRecallTool(memoryManager), requiresPermission: false },
          { ...memoryListTool(memoryManager), requiresPermission: false },
          { ...memoryForgetTool(memoryManager), requiresPermission: false },
        ]
      : []),
    ...(skillManager ? [{ ...skillRunTool(skillManager), requiresPermission: false }] : []),
    { ...processStatusTool(processManager), requiresPermission: false },
    { ...processLogsTool(processManager), requiresPermission: false },
    { ...processKillTool(processManager), requiresPermission: true },
    {
      ...(gitCheckpoints ? gitRollbackTool(ws, gitCheckpoints) : rollbackTool(ws, snapshots)),
      requiresPermission: false,
    },
    ...(provider && model
      ? [
          { ...subagentTool(ws, provider, model, signal, onSubagentEvent), requiresPermission: false },
          { ...subagentParallelTool(ws, provider, model, signal), requiresPermission: false },
          { ...subagentOptimizeTool(ws, provider, model, signal), requiresPermission: false },
          { ...subagentWorkflowTool(ws, provider, model, signal), requiresPermission: false },
        ]
      : []),
    { ...writeFileTool(ws, snapshots), requiresPermission: true },
    { ...editFileTool(ws, snapshots), requiresPermission: true },
    { ...bashTool(ws, processManager, onBashChunk), requiresPermission: true },
  ];

  const registry = new Map(tools.map((t) => [t.name, t]));

  // Dynamically await and attach MCP tools from all connected servers
  for (const client of mcpClients) {
    try {
      const mcpTools = await client.listTools();
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
    } catch {
      // Ignore individual server discovery failure
    }
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
