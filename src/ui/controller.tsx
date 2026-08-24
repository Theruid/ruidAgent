import React from "react";
import { render } from "ink";
import type { LLMProvider, ProviderConfig, LLMMessage } from "../providers/types.js";
import { isProviderUsable, loadConfig } from "../config.js";
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

export interface TuiOptions {
  provider: LLMProvider | null;
  model: string;
  resolveProvider?: () => { name: string; cfg: ProviderConfig; model: string | undefined };
}

const AUTO_APPROVE = new Set(["read_file", "list_dir", "glob", "grep"]);

export function startTui(options: TuiOptions): void {
  const store = new AgentUIStore(
    options.provider?.name ?? "",
    options.model ?? "",
    options.provider !== null && Boolean(options.model),
  );

  let active: { name: string; provider: LLMProvider } | null = options.provider
    ? { name: options.provider.name, provider: options.provider }
    : null;

  let model = options.model;
  const permissions: DeferredPermissions = createDeferredPermissions(AUTO_APPROVE);

  // Current conversation state
  let sessionId = newSessionId();
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
      onSetupDone={() => {
        store.setPhase("idle");
        tryConnect();
      }}
    />,
    { exitOnCtrlC: false },
  );

  function exit(): void {
    flushAutosave();
    instance.unmount();
    process.stdout.write("\x1b[?1049l");
    process.exit(0);
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
        resolved = { name: wantName, cfg: config.providers[wantName], model: config.default.model };
      }
      if (!isProviderUsable(resolved.cfg)) {
        store.setNotice(`"${resolved.name}" has no API key. Run /setup or export the env var.`);
        return;
      }
      active = { name: resolved.name, provider: createProvider(resolved.name, resolved.cfg) };
      if (resolved.model) model = resolved.model;
      store.setConnection(resolved.name, model, Boolean(model));
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
    store.addUserMessage(prompt);
    store.beginTurn();
    abortController = new AbortController();

    try {
      history = await runAgentLoop({
        provider: active!.provider,
        model: model!,
        workspaceRoot: process.cwd(),
        initialPrompt: prompt,
        messages: history,
        signal: abortController.signal,
        permissions: permissions.manager,
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
    history = sess.messages;
    dirty = false;
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
        history = [];
        dirty = false;
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
        const config = loadConfig();
        const lines = Object.entries(config.providers).map(([pname, pcfg]) => {
          const marker =
            active?.name === pname ? " <connected>" : config.default.provider === pname ? " *default*" : "";
          const keyInfo =
            pcfg.type === "openai"
              ? pcfg.apiKey
                ? "inline key"
                : pcfg.apiKeyEnv
                  ? `$${pcfg.apiKeyEnv}`
                  : "no key"
              : "native";
          const usable = isProviderUsable(pcfg) ? "" : " (key missing)";
          return `${pname}${marker}${usable} — ${pcfg.type} [${keyInfo}]`;
        });
        store.setNotice(lines.join(" · ") || "No providers configured.");
        break;
      }

      case "connect":
        if (!rest[0]) {
          store.setNotice("Usage: /connect <provider-name>");
          break;
        }
        tryConnect(rest[0]);
        break;

      case "clear":
        history = [];
        dirty = false;
        store.clearChat();
        store.setNotice("History cleared.");
        break;

      case "model":
        if (rest[0]) {
          model = rest[0];
          store.setConnection(active?.name ?? "", model, active !== null);
          store.setNotice(`Model set to ${model}`);
        } else {
          store.setNotice(`Current model: ${model || "(unset)"}`);
        }
        break;

      case "help":
        store.setNotice("/new /resume /sessions /setup /providers /connect <name> /model <id> /clear /exit");
        break;

      default:
        store.setNotice(`Unknown command. /help lists commands.`);
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
