import React, { useSyncExternalStore, useEffect, useRef, useState, useMemo } from "react";
import { Box, Text, useInput, useStdout } from "ink";
import type { AgentUIStore, UIState } from "./store.js";
import { MessageList } from "./components/MessageList.js";
import { Welcome } from "./components/Welcome.js";
import { InputBox } from "./components/InputBox.js";
import { StatusBar } from "./components/StatusBar.js";
import { PermissionPrompt } from "./components/PermissionPrompt.js";
import { SessionPicker } from "./components/SessionPicker.js";
import { SetupWizard } from "./components/SetupWizard.js";
import { ModelPicker } from "./components/ModelPicker.js";
import { ProviderPicker } from "./components/ProviderPicker.js";
import { TaskPanel } from "./components/TaskPanel.js";
import { UpdatePrompt } from "./components/UpdatePrompt.js";
import { getLocalPackageInfo } from "../updater.js";
import { loadConfig } from "../config.js";
import { noticeRows, permissionPromptRows, taskPanelRows, UPDATE_PROMPT_ROWS } from "./utils/layout.js";

/** Terminal dimensions with resize tracking. */
function useTerminalDimensions(): { rows: number; columns: number } {
  const { stdout } = useStdout();
  const [dims, setDims] = useState({
    rows: stdout.rows ?? 30,
    columns: stdout.columns ?? 80,
  });

  useEffect(() => {
    const onResize = () => {
      setDims({
        rows: stdout.rows ?? 30,
        columns: stdout.columns ?? 80,
      });
    };
    stdout.on("resize", onResize);
    return () => {
      stdout.off("resize", onResize);
    };
  }, [stdout]);

  return dims;
}

import type { CommandItem } from "./components/CommandPalette.js";

export interface AppProps {
  store: AgentUIStore;
  onSubmit(line: string): void;
  onAbortTurn(): void;
  onExit(): void;
  /** Session picker callbacks */
  onPickSession(id: string | null): void;
  onSetupDone(): void;
  onPickModel(model: string | null): void;
  onPickProvider(providerName: string | null): void;
  onCycleMode?(): void;
  customCommands?: CommandItem[];
}

export function App({
  store,
  onSubmit,
  onAbortTurn,
  onExit,
  onPickSession,
  onSetupDone,
  onPickModel,
  onPickProvider,
  onCycleMode,
  customCommands = [],
}: AppProps) {
  const state: UIState = useSyncExternalStore(store.subscribe, store.getState);
  const { rows, columns } = useTerminalDimensions();
  // One row short of the terminal: when Ink's frame fills the whole screen it
  // clears the terminal before every redraw, which flashes on Windows consoles.
  const screenRows = Math.max(10, rows - 1);
  const exitIntent = useRef<number>(0);
  const [inputRows, setInputRows] = useState(3);
  const running = state.phase === "running";

  // Global key routing.
  useInput((input, key) => {
    // 1. Permission prompt: y / n / a, Esc rejects
    if (state.pendingPermission && store.respondPermission && !key.ctrl) {
      if (key.escape) {
        store.respondPermission("n");
        return;
      }
      const lower = input.toLowerCase();
      // Sensitive (tier 4) actions can only be approved one at a time.
      if (lower === "a" && state.pendingPermission.tier === 4) return;
      if (lower === "y" || lower === "n" || lower === "a") {
        store.respondPermission(lower as "y" | "n" | "a");
        return;
      }
    }

    // 2. Ctrl+O: show / hide the full output of the latest tool call
    if (key.ctrl && input === "o") {
      const shown = store.toggleLatestToolOutput();
      if (shown) store.scrollToBottom();
      return;
    }

    // 3. Esc on an empty draft closes a notice panel or collapsed output
    if (key.escape && store.inputEmpty && !state.pendingPermission && state.queuedPrompts.length === 0) {
      if (state.expandedToolId !== null) {
        store.toggleLatestToolOutput();
        return;
      }
      if (state.notice) {
        store.setNotice(null);
        return;
      }
    }

    // 4. Transcript scrolling (Home/End belong to the input while it has text)
    if ((key.home || key.end) && store.inputEmpty) {
      if (key.home) store.scrollToTop();
      else store.scrollToBottom();
      return;
    }
    if (key.pageUp) {
      store.scrollUp(Math.max(3, Math.floor(screenRows / 2)));
      return;
    }
    if (key.pageDown) {
      store.scrollDown(Math.max(3, Math.floor(screenRows / 2)));
      return;
    }
    if (key.ctrl && key.upArrow) {
      store.scrollUp(2);
      return;
    }
    if (key.ctrl && key.downArrow) {
      store.scrollDown(2);
      return;
    }

    // 5. Ctrl+C: interrupt a turn, or exit on a second press
    if (key.ctrl && input === "c") {
      if (running) {
        onAbortTurn();
        store.setNotice("Interrupting…");
        return;
      }
      const now = Date.now();
      if (now - exitIntent.current < 2000) {
        onExit();
      } else {
        exitIntent.current = now;
        store.setNotice("Press Ctrl+C again to exit");
      }
    }
  });

  const showWelcome = state.messages.length === 0 && !state.streamingText && state.tasks.length === 0;
  const showTasks = state.tasks.length > 0 && !state.taskPanelHidden;
  const noticeIsPanel = Boolean(state.notice?.includes("\n"));

  // Calculate remaining height for MessageList: every panel below it reports
  // its real rendered height (see utils/layout.ts).
  let overhead = 1; // StatusBar (1 line)
  if (state.phase === "picker" || state.phase === "wizard") {
    overhead += 10;
  } else if (state.phase === "model-picker" || state.phase === "provider-picker") {
    overhead += 16;
  } else {
    overhead += inputRows;
  }
  overhead += noticeRows(state.notice, columns);
  if (state.pendingPermission) overhead += permissionPromptRows(state.pendingPermission, columns);
  if (state.updateInfo?.hasUpdate) overhead += UPDATE_PROMPT_ROWS;
  if (showTasks) overhead += taskPanelRows(state.tasks);

  const viewportHeight = Math.max(5, screenRows - overhead);
  // Reloading config reads from disk; only do it when the target provider could
  // have changed rather than on every streamed token.
  const currentConfig = useMemo(() => loadConfig(), [state.phase, state.providerName]);
  const activeProviderConfig =
    currentConfig.providers[state.providerName] ??
    (state.providerName === "openai-compatible" ? currentConfig.providers[currentConfig.default.provider] : undefined);
  const { version: currentVersion } = useMemo(() => getLocalPackageInfo(), []);

  const placeholder = !state.connected
    ? "Run /setup to connect a provider…"
    : running
      ? "Working… type to queue a follow-up · Ctrl+C to interrupt"
      : `Ask in [${state.mode.toUpperCase()}] mode… · Tab mode · \\+Enter newline · @ files · / commands`;

  return (
    <Box flexDirection="column" height={screenRows} paddingX={1}>
      <Box flexDirection="column" height={viewportHeight} justifyContent={showWelcome ? "center" : "flex-start"}>
        {showWelcome ? (
          <Welcome connected={state.connected} version={currentVersion} />
        ) : (
          <MessageList
            messages={state.messages}
            streamingText={state.streamingText}
            streamingThought={state.streamingThought}
            streamingThoughtDurationMs={state.streamingThoughtDurationMs}
            viewportHeight={viewportHeight}
            scrollOffset={state.scrollOffset}
            columns={columns}
            running={running}
            activeAction={state.activeAction}
            turnStartedAt={state.turnStartedAt}
            paused={Boolean(state.pendingPermission)}
            onMaxScrollChange={store.setMaxScroll}
            expandedToolId={state.expandedToolId}
          />
        )}
      </Box>

      {showTasks && <TaskPanel tasks={state.tasks} />}

      {state.updateInfo?.hasUpdate && (
        <UpdatePrompt info={state.updateInfo} status={null} />
      )}

      {state.notice &&
        (noticeIsPanel ? (
          <Box borderStyle="round" borderColor="gray" paddingX={1} flexDirection="column">
            <Text>{state.notice}</Text>
            <Text dimColor>Esc to close</Text>
          </Box>
        ) : (
          <Box paddingLeft={1}>
            <Text dimColor>{state.notice}</Text>
          </Box>
        ))}

      {state.pendingPermission && (
        <PermissionPrompt permission={state.pendingPermission} store={store} />
      )}

      {state.phase === "picker" ? (
        <SessionPicker onPick={onPickSession} />
      ) : state.phase === "wizard" ? (
        <SetupWizard onDone={onSetupDone} />
      ) : state.phase === "model-picker" ? (
        <ModelPicker
          providerName={state.providerName}
          providerConfig={activeProviderConfig}
          currentModel={state.model}
          onPick={onPickModel}
        />
      ) : state.phase === "provider-picker" ? (
        <ProviderPicker
          activeProviderName={state.providerName}
          onPick={onPickProvider}
        />
      ) : (
        <InputBox
          onSubmit={onSubmit}
          // Typing stays live while the agent works (prompts queue up); only an
          // approval prompt takes the keyboard.
          disabled={Boolean(state.pendingPermission)}
          initialValue={state.inputDraft}
          customCommands={state.customSkills.length > 0 ? state.customSkills : customCommands}
          history={store.promptHistory}
          columns={columns}
          onHeightChange={setInputRows}
          onDraftEmptyChange={store.setInputEmpty}
          queued={state.queuedPrompts}
          onRestoreQueue={store.takeQueue}
          onCycleMode={onCycleMode}
          onScrollUp={() => store.scrollUp(2)}
          onScrollDown={() => store.scrollDown(2)}
          onScrollToBottom={() => store.scrollToBottom()}
          placeholder={placeholder}
        />
      )}

      <StatusBar
        providerName={state.providerName}
        model={state.model}
        connected={state.connected}
        capabilities={state.capabilities}
        thinkingEnabled={state.thinkingEnabled}
        mode={state.mode}
        taskCount={state.tasks.length}
        mcpCount={state.mcpServerCount}
        skillCount={state.skillCount}
        usage={state.sessionUsage}
        lastTurnLatencyMs={state.lastTurnDurationMs}
        columns={columns}
      />
    </Box>
  );
}

// keep react import used under verbatimModuleSyntax-less configs
void React;
