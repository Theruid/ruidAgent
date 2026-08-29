import type { LoopEvent } from "../agent/loop.js";
import type { LLMMessage, ModelCapabilities } from "../providers/types.js";
import type { AgentMode } from "../permissions.js";
import type { AgentTask } from "../tools/tasks.js";
import { calculateCost } from "./utils/pricing.js";
import { formatToolBadge } from "./utils/toolSummary.js";

import type { UpdateInfo } from "../updater.js";

export type Phase = "idle" | "running" | "picker" | "wizard" | "model-picker" | "provider-picker";

export interface ToolMeta {
  input?: Record<string, unknown>;
  badgeTitle?: string;
  badgeDetail?: string;
  durationMs?: number;
}

export interface ViewMessage {
  id: number;
  kind: "user" | "assistant" | "tool";
  text: string;
  thought?: string;
  thoughtDurationMs?: number;
  toolName?: string;
  toolError?: boolean;
  /** Tool row still awaiting its result — shows a spinner. */
  pending?: boolean;
  toolMeta?: ToolMeta;
}

export interface PendingPermission {
  toolName: string;
  input?: unknown;
  argsPreview?: string;
}

export interface SessionUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  totalCost: number;
}

export interface UIState {
  phase: Phase;
  mode: AgentMode;
  providerName: string;
  model: string;
  connected: boolean;
  capabilities?: ModelCapabilities;
  thinkingEnabled: boolean;
  messages: ViewMessage[];
  streamingText: string;
  streamingThought: string;
  streamingThoughtDurationMs?: number;
  inputDraft: string;
  notice: string | null;
  pendingPermission: PendingPermission | null;
  turnCount: number;
  scrollOffset: number; // 0 = at bottom (latest messages), >0 = scrolled up N lines
  sessionUsage: SessionUsage;
  lastTurnDurationMs: number;
  tasks: AgentTask[];
  updateInfo: UpdateInfo | null;
  mcpServerCount: number;
  skillCount: number;
  memoryCount: number;
}

// Framework-free store so non-React code (agent loop callbacks) can push
// events without prop drilling or stale closures. React subscribes via
// useSyncExternalStore.
export class AgentUIStore {
  private state: UIState;
  private listeners = new Set<() => void>();
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private dirty = false;

  /** Set by the controller so React components can resolve permission prompts. */
  private _permissionCallback: ((answer: "y" | "n" | "a") => void) | null = null;

  set respondPermission(cb: ((answer: "y" | "n" | "a") => void) | null) {
    this._permissionCallback = cb;
  }

  get respondPermission(): ((answer: "y" | "n" | "a") => void) | null {
    return this._permissionCallback
      ? (answer: "y" | "n" | "a") => {
          this.set({ pendingPermission: null }, true);
          this._permissionCallback?.(answer);
        }
      : null;
  }

  // text and thought deltas accumulate here between coalesced flushes
  private streamBuf = "";
  private thoughtBuf = "";
  private thoughtStartTime: number | null = null;
  private thoughtDurationMs: number | null = null;
  private nextId = 1;
  private toolStartTimes = new Map<string, number>();

  constructor(
    providerName: string,
    model: string,
    connected: boolean,
    initialMode: AgentMode = "code",
    capabilities?: ModelCapabilities
  ) {
    this.state = {
      phase: "idle",
      mode: initialMode,
      providerName,
      model,
      connected,
      capabilities,
      thinkingEnabled: capabilities?.supportsThinking ?? true,
      messages: [],
      streamingText: "",
      streamingThought: "",
      streamingThoughtDurationMs: undefined,
      inputDraft: "",
      notice: null,
      pendingPermission: null,
      turnCount: 0,
      scrollOffset: 0,
      sessionUsage: {
        inputTokens: 0,
        outputTokens: 0,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
        totalCost: 0,
      },
      lastTurnDurationMs: 0,
      tasks: [],
      updateInfo: null,
      mcpServerCount: 0,
      skillCount: 0,
      memoryCount: 0,
    };
  }

  getState = (): UIState => this.state;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  private set(patch: Partial<UIState>, immediate = false): void {
    this.state = { ...this.state, ...patch };
    if (immediate) {
      this.dirty = false;
      for (const fn of this.listeners) fn();
      return;
    }
    if (this.flushTimer === null) {
      this.flushTimer = setInterval(() => this.flush(), 40);
    }
    this.dirty = true;
  }

  private flush(): void {
    if (!this.dirty) return;
    this.dirty = false;
    for (const fn of this.listeners) fn();
  }

  private stopFlush(): void {
    if (this.flushTimer !== null) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }

  // ---- lifecycle ----

  setUpdateInfo(updateInfo: UpdateInfo | null): void {
    this.set({ updateInfo }, true);
  }

  setInputDraft(draft: string): void {
    this.set({ inputDraft: draft }, true);
  }

  setMode(mode: AgentMode): void {
    this.set({ mode }, true);
  }

  cycleMode(): AgentMode {
    const order: AgentMode[] = ["code", "plan", "auto"];
    const nextIdx = (order.indexOf(this.state.mode) + 1) % order.length;
    const nextMode = order[nextIdx];
    this.setMode(nextMode);
    return nextMode;
  }

  setTasks(tasks: AgentTask[]): void {
    this.set({ tasks }, true);
  }

  setMcpServerCount(count: number): void {
    this.set({ mcpServerCount: count }, true);
  }

  setSkillCount(count: number): void {
    this.set({ skillCount: count }, true);
  }

  setMemoryCount(count: number): void {
    this.set({ memoryCount: count }, true);
  }

  setScrollOffset(offset: number): void {
    this.set({ scrollOffset: Math.max(0, offset) }, true);
  }

  scrollUp(lines = 5): void {
    this.set({ scrollOffset: this.state.scrollOffset + lines }, true);
  }

  scrollDown(lines = 5): void {
    this.set({ scrollOffset: Math.max(0, this.state.scrollOffset - lines) }, true);
  }

  scrollToBottom(): void {
    if (this.state.scrollOffset !== 0) {
      this.set({ scrollOffset: 0 }, true);
    }
  }

  setConnection(providerName: string, model: string, connected: boolean, capabilities?: ModelCapabilities): void {
    this.set({ providerName, model, connected, capabilities }, true);
  }

  toggleThinking(): boolean {
    const next = !this.state.thinkingEnabled;
    this.set({ thinkingEnabled: next }, true);
    return next;
  }

  setNotice(notice: string | null): void {
    this.set({ notice }, true);
  }

  setPhase(phase: Phase): void {
    this.set({ phase }, true);
  }

  clearChat(): void {
    this.nextId = 1;
    this.thoughtStartTime = null;
    this.thoughtDurationMs = null;
    this.set({ messages: [], streamingText: "", streamingThought: "", streamingThoughtDurationMs: undefined, turnCount: 0, scrollOffset: 0 }, true);
  }

  loadMessages(messages: ViewMessage[]): void {
    this.nextId = messages.reduce((m, x) => Math.max(m, x.id + 1), 1);
    this.thoughtStartTime = null;
    this.thoughtDurationMs = null;
    this.set(
      {
        messages,
        streamingText: "",
        streamingThought: "",
        streamingThoughtDurationMs: undefined,
        turnCount: messages.filter((m) => m.kind !== "tool").length,
        scrollOffset: 0,
      },
      true,
    );
  }

  // ---- turn flow ----

  beginTurn(): void {
    this.streamBuf = "";
    this.thoughtBuf = "";
    this.thoughtStartTime = null;
    this.thoughtDurationMs = null;
    this.set({ phase: "running", streamingText: "", streamingThought: "", streamingThoughtDurationMs: undefined, notice: null, scrollOffset: 0 }, true);
  }

  addUserMessage(text: string): void {
    const msg: ViewMessage = { id: this.nextId++, kind: "user", text };
    this.set(
      { messages: [...this.state.messages, msg], turnCount: this.state.turnCount + 1, scrollOffset: 0 },
      true,
    );
  }

  applyLoopEvent(e: LoopEvent): void {
    switch (e.type) {
      case "text_delta":
        if (this.thoughtStartTime && this.thoughtDurationMs === null) {
          this.thoughtDurationMs = Date.now() - this.thoughtStartTime;
        }
        this.streamBuf += e.text;
        this.set({ streamingText: this.streamBuf, streamingThoughtDurationMs: this.thoughtDurationMs ?? undefined }, true);
        break;

      case "thought_delta":
        if (!this.thoughtStartTime) {
          this.thoughtStartTime = Date.now();
        }
        this.thoughtBuf += e.text;
        this.set({
          streamingThought: this.thoughtBuf,
          streamingThoughtDurationMs: Date.now() - this.thoughtStartTime,
        }, true);
        break;

      case "tool_start": {
        this.toolStartTimes.set(e.name, Date.now());
        const inputObj = e.input && typeof e.input === "object" ? (e.input as Record<string, unknown>) : undefined;
        const badge = formatToolBadge(e.name, inputObj, undefined, false);
        const msg: ViewMessage = {
          id: this.nextId++,
          kind: "tool",
          text: "",
          toolName: e.name,
          pending: true,
          toolMeta: {
            input: inputObj,
            badgeTitle: badge.title,
            badgeDetail: badge.detail,
          },
        };
        // Flush any buffered assistant text into its own row before the tool row.
        const patch: Partial<UIState> = { messages: [...this.state.messages, msg], pendingPermission: null };
        if (this.streamBuf) {
          patch.streamingText = "";
          this.commitStreamRow(patch);
        } else {
          this.set(patch, true);
        }
        break;
      }

      case "tool_result": {
        const startTime = this.toolStartTimes.get(e.name);
        const durationMs = startTime ? Date.now() - startTime : undefined;
        this.toolStartTimes.delete(e.name);

        const messages = [...this.state.messages];
        let idx = -1;
        for (let i = messages.length - 1; i >= 0; i--) {
          if (messages[i].kind === "tool" && messages[i].pending && messages[i].toolName === e.name) {
            idx = i;
            break;
          }
        }
        if (idx >= 0) {
          const oldMsg = messages[idx];
          const badge = formatToolBadge(e.name, oldMsg.toolMeta?.input, e.content, e.isError);
          const preview = e.content.length > 200 ? e.content.slice(0, 200) + "…" : e.content;
          messages[idx] = {
            ...oldMsg,
            pending: false,
            toolError: e.isError,
            text: preview.replace(/\n/g, " ").trim(),
            toolMeta: {
              ...oldMsg.toolMeta,
              badgeTitle: badge.title,
              badgeDetail: badge.detail,
              durationMs,
            },
          };
        }
        this.set({ messages, pendingPermission: null }, true);
        break;
      }

      case "permission_request": {
        let argsPreview: string | undefined;
        if (e.input && typeof e.input === "object") {
          const inp = e.input as Record<string, unknown>;
          if (typeof inp.command === "string") {
            argsPreview = inp.command;
          } else if (typeof inp.path === "string") {
            argsPreview = inp.path;
          } else {
            try {
              argsPreview = JSON.stringify(e.input);
            } catch {
              // ignore
            }
          }
        }
        this.set({ pendingPermission: { toolName: e.name, input: e.input, argsPreview } }, true);
        break;
      }

      case "permission_denied":
        this.set({ pendingPermission: null }, true);
        break;

      case "usage": {
        const newIn = this.state.sessionUsage.inputTokens + e.inputTokens;
        const newOut = this.state.sessionUsage.outputTokens + e.outputTokens;
        const newCacheCreation = this.state.sessionUsage.cacheCreationInputTokens + (e.cacheCreationInputTokens ?? 0);
        const newCacheRead = this.state.sessionUsage.cacheReadInputTokens + (e.cacheReadInputTokens ?? 0);
        const totalCost = calculateCost(this.state.model, newIn, newOut, newCacheRead, newCacheCreation);
        this.set(
          {
            sessionUsage: {
              inputTokens: newIn,
              outputTokens: newOut,
              cacheCreationInputTokens: newCacheCreation,
              cacheReadInputTokens: newCacheRead,
              totalCost,
            },
            lastTurnDurationMs: e.durationMs ?? this.state.lastTurnDurationMs,
          },
          true,
        );
        break;
      }

      case "tasks_updated":
        this.set({ tasks: e.tasks }, true);
        break;

      case "iteration":
        break;
    }
  }

  private commitStreamRow(patch: Partial<UIState>): void {
    const text = this.streamBuf.trim();
    const thought = this.thoughtBuf.trim() || undefined;
    const duration =
      this.thoughtDurationMs ??
      (this.thoughtStartTime ? Date.now() - this.thoughtStartTime : undefined);

    if (text || thought) {
      const msg: ViewMessage = {
        id: this.nextId++,
        kind: "assistant",
        text: text || "",
        thought,
        thoughtDurationMs: duration,
      };
      patch.messages = [...(patch.messages ?? this.state.messages), msg];
      patch.turnCount = this.state.turnCount + 1;
    }
    this.streamBuf = "";
    this.thoughtBuf = "";
    this.thoughtStartTime = null;
    this.thoughtDurationMs = null;
    patch.streamingText = "";
    patch.streamingThought = "";
    patch.streamingThoughtDurationMs = undefined;
    this.set(patch, true);
  }

  endTurn(finalMessages: LLMMessage[] | null, error?: string): void {
    // Clear pending spinner status on any tool rows that were in flight when aborted
    const cleanedMessages = this.state.messages.map((m) =>
      m.kind === "tool" && m.pending
        ? {
            ...m,
            pending: false,
            toolError: true,
            text: error ? `Interrupted: ${error}` : "(cancelled by user)",
          }
        : m
    );

    const patch: Partial<UIState> = {
      phase: "idle",
      pendingPermission: null,
      streamingText: "",
      streamingThought: "",
      messages: cleanedMessages,
    };
    if (this.streamBuf.trim() || this.thoughtBuf.trim()) {
      this.commitStreamRow(patch);
    }
    if (error) patch.notice = error;
    this.stopFlush();
    this.dirty = false;
    this.set(patch, true);

    // Keep only committed rows; caller decides what to do with history.
    void finalMessages;
  }
}
