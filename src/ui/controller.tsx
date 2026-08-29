import React from "react";
import { render } from "ink";
import type { LLMProvider, ProviderConfig, LLMMessage } from "../providers/types.js";
import { isProviderUsable, loadConfig, resolveProviderModel } from "../config.js";
import { createProvider } from "../index.js";
import { runAgentLoop } from "../agent/loop.js";
import {
  createDeferredPermissions,
  type DeferredPermissions,
} from "../permissions.js";
import { AgentUIStore } from "./store.js";
import { App } from "./App.js";
import {
  saveSession,
  newSessionId,
  titleFromMessages,
  loadSession,
} from "../sessions.js";

import fs from "node:fs";
import path from "node:path";
import { TaskStore } from "../tools/tasks.js";
import { SnapshotManager } from "../tools/snapshot.js";
import { GitCheckpointManager } from "../tools/gitRollback.js";
import { checkForUpdate, getLocalPackageInfo } from "../updater.js";
import { MCPClient } from "../mcp/client.js";
import { MemoryManager } from "../memory/manager.js";
import { SkillManager } from "../skills/loader.js";
import type { CommandItem } from "./components/CommandPalette.js";

/**
 * Scans a user prompt for `@filepath` mentions and attaches file contents if found.
 */
function resolveAtFileMentions(prompt: string, workspaceRoot: string): string {
  const atRegex = /@([a-zA-Z0-9_\-./\\]+\.[a-zA-Z0-9]+)/g;
  const matches = [...prompt.matchAll(atRegex)];
  if (matches.length === 0) return prompt;

  const attachments: string[] = [];
  const seen = new Set<string>();

  for (const m of matches) {
    const rel = m[1].replace(/\\/g, "/");
    if (seen.has(rel)) continue;
    seen.add(rel);

    const abs = path.join(workspaceRoot, rel);
    if (fs.existsSync(abs)) {
      try {
        const stat = fs.statSync(abs);
        if (stat.isFile() && stat.size < 256 * 1024) {
          const content = fs.readFileSync(abs, "utf8");
          attachments.push(`\n\n--- Content of @${rel} ---\n${content}\n--- End of @${rel} ---`);
        }
      } catch {
        // Skip unreadable files
      }
    }
  }

  return attachments.length > 0 ? `${prompt}${attachments.join("")}` : prompt;
}

export interface TuiOptions {
  provider: LLMProvider | null;
  model: string;
  resolveProvider?: () => { name: string; cfg: ProviderConfig; model: string | undefined };
}

const AUTO_APPROVE = new Set([
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
  "task_delete",
  "rollback",
  "subagent_spawn",
]);

export function startTui(options: TuiOptions): void {
  const initialCaps = options.provider?.capabilities ? options.provider.capabilities(options.model) : undefined;
  const store = new AgentUIStore(
    options.provider?.name ?? "",
    options.model ?? "",
    options.provider !== null && Boolean(options.model),
    "code",
    initialCaps
  );

  let active: { name: string; provider: LLMProvider } | null = options.provider
    ? { name: options.provider.name, provider: options.provider }
    : null;

  let model = options.model;
  const permissions: DeferredPermissions = createDeferredPermissions(AUTO_APPROVE);
  const taskStore = new TaskStore();
  const snapshots = new SnapshotManager();
  const gitCheckpoints = new GitCheckpointManager();
  const memoryManager = new MemoryManager({ workspaceRoot: process.cwd() });
  const skillManager = new SkillManager({ workspaceRoot: process.cwd() });

  let customSkillCommands: CommandItem[] = [];
  skillManager.loadSkills().then((skills) => {
    customSkillCommands = skills.map((s) => ({
      name: `/${s.name}`,
      args: s.args,
      description: `[Skill] ${s.description}`,
    }));
    store.setCustomSkills(customSkillCommands);
  }).catch(() => {});

  // Instantiate and connect configured MCP servers
  const mcpClients: MCPClient[] = [];
  const appConfig = loadConfig();
  if (appConfig.mcpServers) {
    for (const [serverName, serverCfg] of Object.entries(appConfig.mcpServers)) {
      if (serverCfg.disabled) continue;
      const client = new MCPClient(serverName, serverCfg);
      mcpClients.push(client);
      client.connect().then(() => {
        store.setMcpServerCount(mcpClients.length);
      }).catch(() => {
        // Safe fallback if an external MCP server fails to connect
      });
    }
    store.setMcpServerCount(mcpClients.length);
  }

  // Current conversation state
  let sessionId = newSessionId();
  snapshots.attachSession(sessionId);
  gitCheckpoints.attachSession(sessionId);
  let history: LLMMessage[] = [];
  let dirty = false; // has content worth autosaving

  process.stdout.write("\x1b[?1049h");
  const instance = render(
    <App
      store={store}
      onSubmit={submitLine}
      onAbortTurn={abortTurn}
      onExit={exit}
      onPickSession={pickSession}
      customCommands={customSkillCommands}
      onSetupDone={() => {
        store.setPhase("idle");
        tryConnect();
      }}
      onPickModel={pickModel}
      onPickProvider={pickProvider}
      onCycleMode={() => {
        const nextMode = store.cycleMode();
        permissions.setMode(nextMode);
        store.setNotice(`Switched to [${nextMode.toUpperCase()}] mode`);
      }}
    />,
    { exitOnCtrlC: false },
  );

  // Check for newer npm release in background
  checkForUpdate().then((updateInfo) => {
    if (updateInfo?.hasUpdate) {
      store.setUpdateInfo(updateInfo);
    }
  }).catch(() => {});

  function exit(): void {
    flushAutosave();
    for (const client of mcpClients) {
      client.close().catch(() => {});
    }
    instance.unmount();
    process.stdout.write("\x1b[?1049l");
    process.exit(0);
  }

  function pickModel(chosenModel: string | null): void {
    store.setPhase("idle");
    if (chosenModel) {
      model = chosenModel;
      const caps = active?.provider?.capabilities ? active.provider.capabilities(model) : undefined;
      store.setConnection(active?.name ?? "", model, active !== null, caps);
      store.setNotice(`Model switched to ${model}`);
    }
  }

  function pickProvider(chosenProvider: string | null): void {
    store.setPhase("idle");
    if (chosenProvider) {
      tryConnect(chosenProvider);
    }
  }

  function abortTurn(): void {
    abortController?.abort();
  }

  let abortController: AbortController | null = null;

  function tryConnect(wantName?: string): void {
    if (!options.resolveProvider) {
      store.setNotice("Provider switching unavailable in this session.");
      return;
    }
    try {
      let resolved = options.resolveProvider();
      if (wantName) {
        const config = loadConfig();
        if (!config.providers[wantName]) {
          store.setNotice(
            `Unknown provider "${wantName}". Known: ${Object.keys(config.providers).join(", ") || "(none — run /setup)"}`,
          );
          return;
        }
        const targetCfg = config.providers[wantName];
        const targetModel = resolveProviderModel(wantName, targetCfg, config);
        resolved = { name: wantName, cfg: targetCfg, model: targetModel };
      }
      if (!isProviderUsable(resolved.cfg)) {
        store.setNotice(`"${resolved.name}" has no API key. Run /setup or export the env var.`);
        return;
      }
      const newProvider = createProvider(resolved.name, resolved.cfg);
      active = { name: resolved.name, provider: newProvider };
      if (resolved.model) model = resolved.model;
      const caps = newProvider.capabilities ? newProvider.capabilities(model) : undefined;
      store.setConnection(resolved.name, model, Boolean(model), caps);
      store.setNotice(`Connected: ${resolved.name}${model ? ` (${model})` : ""}`);
    } catch (e) {
      active = null;
      store.setConnection("", model, false);
      store.setNotice(`Could not connect${wantName ? ` to "${wantName}"` : ""}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function submitLine(raw: string): Promise<void> {
    if (raw.startsWith("/")) {
      await handleCommand(raw);
      return;
    }

    if (!active || !model) {
      store.setNotice("No provider connected yet — run /setup first.");
      return;
    }

    await runTurn(raw);
  }

  async function runTurn(prompt: string): Promise<void> {
    const resolvedPrompt = resolveAtFileMentions(prompt, process.cwd());
    store.addUserMessage(prompt);
    store.beginTurn();
    abortController = new AbortController();

    try {
      history = await runAgentLoop({
        provider: active!.provider,
        model: model!,
        workspaceRoot: process.cwd(),
        initialPrompt: resolvedPrompt,
        messages: history,
        thinkingEnabled: store.getState().thinkingEnabled,
        signal: abortController.signal,
        permissions: permissions.manager,
        taskStore,
        snapshots,
        gitCheckpoints,
        memoryManager,
        skillManager,
        mcpClients,
        hooks: appConfig.hooks,
        sessionId,
        onEvent: (e) => store.applyLoopEvent(e),
      });
      dirty = true;
      flushAutosave();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // Drop the failed user turn so history stays consistent.
      const last = history.at(-1);
      if (last?.role === "user" && last.content[0]?.type === "text" && last.content[0].text === prompt) {
        history.pop();
      }
      store.endTurn(null, `Error: ${msg}`);
      abortController = null;
      return;
    }
    abortController = null;
    store.endTurn(history);
  }

  /** Called by App-level key routing when a permission is pending. */
  function respondPermission(answer: "y" | "n" | "a"): void {
    permissions.respond(answer);
  }

  function flushAutosave(): void {
    if (!dirty || history.length === 0) return;
    saveSession({
      id: sessionId,
      title: titleFromMessages(history),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      providerName: active?.name ?? "?",
      model: model ?? "?",
      messages: history,
      tasks: taskStore.list(),
    });
    dirty = false;
  }

  function pickSession(id: string | null): void {
    store.setPhase("idle");
    if (!id) return;
    const sess = loadSession(id);
    if (!sess) {
      store.setNotice(`Could not load session ${id}`);
      return;
    }
    flushAutosave();
    sessionId = sess.id;
    snapshots.attachSession(sessionId);
    gitCheckpoints.attachSession(sessionId);
    history = sess.messages;
    dirty = false;
    if (sess.tasks && Array.isArray(sess.tasks)) {
      taskStore.restore(sess.tasks);
      store.setTasks(taskStore.list());
    } else {
      taskStore.clear();
      store.setTasks([]);
    }
    store.loadMessages(toViewMessages(history));
    if (active === null || sess.providerName !== active.name) {
      if (sess.providerName && sess.providerName !== "?") tryConnect(sess.providerName);
    }
    if (model !== sess.model && sess.model !== "?") {
      model = sess.model;
      store.setConnection(active?.name ?? "", model, active !== null);
    }
    store.setNotice(`Resumed "${sess.title}"`);
  }

  async function handleCommand(cmd: string): Promise<void> {
    const [name, ...rest] = cmd.slice(1).split(/\s+/);
    switch (name) {
      case "exit":
      case "quit":
        exit();
        break;

      case "new":
        flushAutosave();
        sessionId = newSessionId();
        snapshots.attachSession(sessionId);
        gitCheckpoints.attachSession(sessionId);
        history = [];
        dirty = false;
        taskStore.clear();
        store.setTasks([]);
        store.clearChat();
        store.setNotice("New chat started.");
        break;

      case "resume":
      case "sessions":
        store.setPhase("picker");
        break;

      case "setup":
        store.setPhase("wizard");
        break;

      case "providers": {
        store.setPhase("provider-picker");
        break;
      }

      case "connect":
        if (!rest[0]) {
          store.setPhase("provider-picker");
          break;
        }
        tryConnect(rest[0]);
        break;

      case "think":
      case "thinking": {
        const enabled = store.toggleThinking();
        store.setNotice(`Thinking ${enabled ? "enabled (ON)" : "disabled (OFF)"}`);
        break;
      }

      case "clear":
        history = [];
        dirty = false;
        taskStore.clear();
        store.setTasks([]);
        store.clearChat();
        store.setNotice("History cleared.");
        break;

      case "model":
        if (rest[0]) {
          model = rest[0];
          store.setConnection(active?.name ?? "", model, active !== null);
          store.setNotice(`Model set to ${model}`);
        } else {
          if (!active) {
            store.setNotice("No provider connected — run /setup or /connect first.");
          } else {
            store.setPhase("model-picker");
          }
        }
        break;

      case "mode": {
        const target = rest[0]?.toLowerCase();
        if (target === "code" || target === "plan" || target === "auto") {
          store.setMode(target);
          permissions.setMode(target);
          store.setNotice(`Mode set to [${target.toUpperCase()}]`);
        } else {
          const current = store.getState().mode;
          store.setNotice(`Current mode: [${current.toUpperCase()}]. Valid modes: /mode code | /mode plan | /mode auto (or press Tab)`);
        }
        break;
      }

      case "mcp": {
        if (mcpClients.length === 0) {
          store.setNotice("No MCP servers configured in ~/.ruid/config.json");
          break;
        }
        const summaries: string[] = [];
        for (const client of mcpClients) {
          try {
            const tools = await client.listTools();
            summaries.push(`• ${client.serverName}: ${tools.length} tools (${tools.map((t) => t.name).slice(0, 3).join(", ")}${tools.length > 3 ? "..." : ""})`);
          } catch {
            summaries.push(`• ${client.serverName}: disconnected/error`);
          }
        }
        store.setNotice(`MCP Servers:\n${summaries.join("\n")}`);
        break;
      }

      case "tasks":
      case "plan": {
        const tasks = store.getState().tasks;
        if (tasks.length === 0) {
          store.setNotice("No tasks tracked yet.");
        } else {
          const listStr = tasks
            .map((t) => `#${t.id} [${t.status}] ${t.subject}`)
            .join(" · ");
          store.setNotice(listStr);
        }
        break;
      }

      case "hooks": {
        const hooks = appConfig.hooks;
        const pre = hooks?.preToolUse ?? [];
        const post = hooks?.postToolUse ?? [];
        if (pre.length === 0 && post.length === 0) {
          store.setNotice("No tool execution hooks configured in ~/.ruid/config.json");
          break;
        }
        const lines = ["Configured Hooks:"];
        if (pre.length > 0) {
          lines.push("  Pre-tool hooks:");
          pre.forEach((h) => lines.push(`    - tool: ${h.tool ?? "*"} -> ${h.command}`));
        }
        if (post.length > 0) {
          lines.push("  Post-tool hooks:");
          post.forEach((h) => lines.push(`    - tool: ${h.tool ?? "*"} -> ${h.command}`));
        }
        store.setNotice(lines.join("\n"));
        break;
      }

      case "rollback": {
        const turnNum = rest[0] ? parseInt(rest[0], 10) : undefined;
        try {
          const { restored, deleted, deletedDirs } = await gitCheckpoints.rollback(process.cwd(), turnNum);

          // Find and pop the last user prompt turn from history
          let lastUserPrompt = "";
          while (history.length > 0) {
            const popped = history.pop();
            if (popped?.role === "user") {
              const textContent = popped.content.find((c) => c.type === "text");
              if (textContent && textContent.type === "text") {
                lastUserPrompt = textContent.text;
                break;
              }
            }
          }

          // Reload UI view rows
          store.loadMessages(toViewMessages(history));
          if (lastUserPrompt) {
            store.setInputDraft(lastUserPrompt);
          }

          const fileSummary = [];
          if (restored.length > 0) fileSummary.push(`Restored: ${restored.join(", ")}`);
          if (deleted.length > 0) fileSummary.push(`Removed files: ${deleted.join(", ")}`);
          if (deletedDirs && deletedDirs.length > 0) fileSummary.push(`Removed directories: ${deletedDirs.join(", ")}`);
          if (fileSummary.length === 0) {
            store.setNotice("Rolled back conversation turn (no disk changes to revert).");
          } else {
            store.setNotice(`Rolled back — ${fileSummary.join("; ")}`);
          }
        } catch (err: any) {
          store.setNotice(`Rollback failed: ${err.message}`);
        }
        break;
      }

      case "remember": {
        const text = rest.join(" ").trim();
        if (!text) {
          store.setNotice("Usage: /remember <rule, preference, or fact>");
          break;
        }
        try {
          const saved = await memoryManager.store({
            category: "feedback",
            scope: "workspace",
            title: text.slice(0, 40),
            content: text,
          });
          store.setNotice(`✓ Saved to memory [${saved.id}]: "${text}"`);
        } catch (err: any) {
          store.setNotice(`Failed to save memory: ${err.message}`);
        }
        break;
      }

      case "memory": {
        const sub = rest[0]?.toLowerCase();
        if (sub === "forget" || sub === "delete") {
          const id = rest[1];
          if (!id) {
            store.setNotice("Usage: /memory forget <id>");
            break;
          }
          const ok = await memoryManager.forget(id);
          store.setNotice(ok ? `✓ Forgot memory record "${id}"` : `Memory record "${id}" not found.`);
          break;
        }

        if (sub === "rebuild") {
          await memoryManager.rebuildIndex("workspace");
          await memoryManager.rebuildIndex("global");
          store.setNotice("✓ Rebuilt MEMORY.md index across workspace and global scopes.");
          break;
        }

        // List memories
        const records = await memoryManager.list();
        if (records.length === 0) {
          store.setNotice("No persistent memory stored yet. Use /remember <text> or memory_store.");
          break;
        }

        const lines = records.slice(0, 10).map((r) => `• [${r.id}] (${r.scope}/${r.category}) ${r.title}`);
        if (records.length > 10) lines.push(`… and ${records.length - 10} more`);
        store.setNotice(`Active Memories (${records.length}):\n${lines.join("\n")}`);
        break;
      }

      case "skills": {
        const skills = await skillManager.loadSkills();
        if (skills.length === 0) {
          store.setNotice("No custom skills found in .ruid/skills/ or ~/.ruid/skills/");
          break;
        }

        const lines = skills.map((s) => `• /${s.name}${s.args ? ` ${s.args}` : ""}${s.mode ? ` [${s.mode}]` : ""}: ${s.description}`);
        store.setNotice(`Available Skills (${skills.length}):\n${lines.join("\n")}`);
        break;
      }

      case "version": {
        const { version } = getLocalPackageInfo();
        store.setNotice(`ruid v${version}`);
        break;
      }

      case "help":
        store.setNotice("/new /resume /sessions /setup /mcp /skills /memory /remember /providers /connect <name> /model <id> /mode <code|plan|auto> /rollback /tasks /version /clear /exit");
        break;

      default: {
        // Check if custom skill matches the slash command
        const skill = await skillManager.getSkill(name);
        if (skill) {
          const argsStr = rest.join(" ");
          const renderedPrompt = skillManager.renderSkill(skill, argsStr);

          // If skill explicitly requests a mode, apply it
          if (skill.mode && skill.mode !== store.getState().mode) {
            store.setMode(skill.mode);
            permissions.setMode(skill.mode);
          }

          store.setNotice(`Executing skill: /${skill.name}`);
          await runTurn(renderedPrompt);
          break;
        }

        store.setNotice(`Unknown command /${name}. /help lists commands.`);
      }
    }
  }

  // Expose permission responses through the global key router in App.
  store.respondPermission = respondPermission;
}

import { formatToolBadge } from "./utils/toolSummary.js";
import type { ViewMessage } from "./store.js";

/** Convert stored LLM messages into view rows for session resume. */
function toViewMessages(messages: LLMMessage[]): ViewMessage[] {
  const rows: ViewMessage[] = [];
  let id = 1;
  const toolCallsById = new Map<string, { name: string; input?: Record<string, unknown> }>();

  for (const m of messages) {
    if (m.role === "user") {
      for (const c of m.content) {
        if (c.type === "text") {
          rows.push({ id: id++, kind: "user", text: c.text });
        } else if (c.type === "tool_result") {
          const callInfo = toolCallsById.get(c.toolCallId);
          const toolName = callInfo?.name || "tool";
          const badge = formatToolBadge(toolName, callInfo?.input, c.content, c.isError);
          rows.push({
            id: id++,
            kind: "tool",
            text: c.content.slice(0, 200),
            toolName,
            toolError: c.isError,
            toolMeta: {
              input: callInfo?.input,
              badgeTitle: badge.title,
              badgeDetail: badge.detail,
            },
          });
        }
      }
    } else {
      for (const c of m.content) {
        if (c.type === "text") {
          rows.push({ id: id++, kind: "assistant", text: c.text });
        } else if (c.type === "tool_call") {
          const inputObj = c.input && typeof c.input === "object" ? (c.input as Record<string, unknown>) : undefined;
          toolCallsById.set(c.id, { name: c.name, input: inputObj });
        }
      }
    }
  }
  return rows;
}
