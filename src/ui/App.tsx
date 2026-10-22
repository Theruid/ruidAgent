import React, { useSyncExternalStore, useEffect, useRef, useState, useMemo } from "react";
import { Box, Text, useInput } from "ink";
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
import { permissionPromptRows, taskPanelRows, textRows, UPDATE_PROMPT_ROWS } from "./utils/layout.js";

/** Terminal dimensions with resize tracking. */
function useTerminalDimensions(): { rows: number; columns: number } {
  const [dims, setDims] = useState({
    rows: process.stdout.rows ?? 30,
    columns: process.stdout.columns ?? 80,
  });

  useEffect(() => {
    const onResize = () => {
      setDims({
        rows: process.stdout.rows ?? 30,
        columns: process.stdout.columns ?? 80,
      });
    };
    process.stdout.on("resize", onResize);
    return () => {
      process.stdout.off("resize", onResize);
    };
  }, []);

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
  const exitIntent = useRef<number>(0);
  const [inputRows, setInputRows] = useState(3);

  // Global key routing.
  useInput((input, key) => {
    // 1. Permission Prompt handling
    if (state.pendingPermission && store.respondPermission && !key.ctrl) {
      const lower = input.toLowerCase();
      if (lower === "y" || lower === "n" || lower === "a") {
        store.respondPermission(lower as "y" | "n" | "a");
        return;
      }
    }

    // 2. Global Scrolling Keys (PageUp / PageDown / Home / End)
    if (key.home) {
      store.scrollToTop();
      return;
    }
    if (key.end) {
      store.scrollToBottom();
      return;
    }
    if (key.pageUp) {
      store.scrollUp(Math.max(3, Math.floor(rows / 2)));
      return;
    }
    if (key.pageDown) {
      store.scrollDown(Math.max(3, Math.floor(rows / 2)));
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

    // 3. Ctrl+C handler
    if (key.ctrl && input === "c") {
      if (state.phase === "running") {
        onAbortTurn();
        store.setNotice("Turn interrupted by user");
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
  if (state.notice) overhead += textRows(state.notice, columns - 3);
  if (state.pendingPermission) overhead += permissionPromptRows(state.pendingPermission, columns);
  if (state.updateInfo?.hasUpdate) overhead += UPDATE_PROMPT_ROWS;
  overhead += taskPanelRows(state.tasks);

  const viewportHeight = Math.max(5, rows - overhead);
  // Reloading config reads from disk; only do it when the target provider could
  // have changed rather than on every streamed token.
  const currentConfig = useMemo(() => loadConfig(), [state.phase, state.providerName]);
  const activeProviderConfig =
    currentConfig.providers[state.providerName] ??
    (state.providerName === "openai-compatible" ? currentConfig.providers[currentConfig.default.provider] : undefined);
  const { version: currentVersion } = useMemo(() => getLocalPackageInfo(), []);

  return (
    <Box flexDirection="column" height={rows} paddingX={1}>
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
            running={state.phase === "running"}
            activeAction={state.activeAction}
            turnStartedAt={state.turnStartedAt}
            paused={Boolean(state.pendingPermission)}
            onMaxScrollChange={store.setMaxScroll}
          />
        )}
      </Box>

      {state.tasks.length > 0 && <TaskPanel tasks={state.tasks} />}

      {state.updateInfo?.hasUpdate && (
        <UpdatePrompt info={state.updateInfo} status={null} />
      )}

      {state.notice && (
        <Box paddingLeft={1}>
          <Text dimColor>{state.notice}</Text>
        </Box>
      )}

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
          disabled={state.phase === "running" || Boolean(state.pendingPermission)}
          initialValue={state.inputDraft}
          customCommands={state.customSkills.length > 0 ? state.customSkills : customCommands}
          history={store.promptHistory}
          columns={columns}
          onHeightChange={setInputRows}
          onCycleMode={onCycleMode}
          onScrollUp={() => store.scrollUp(2)}
          onScrollDown={() => store.scrollDown(2)}
          onScrollToBottom={() => store.scrollToBottom()}
          placeholder={
            !state.connected
              ? "Run /setup to connect a provider…"
              : state.phase === "running"
                ? "Working… (Ctrl+C to interrupt)"
                : `Ask in [${state.mode.toUpperCase()}] mode… (Tab: mode, Ctrl+Enter: newline, @file, /help)`
          }
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
      />
    </Box>
  );
}

// keep react import used under verbatimModuleSyntax-less configs
void React;
