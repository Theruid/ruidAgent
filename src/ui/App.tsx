import React, { useSyncExternalStore, useEffect, useRef, useState } from "react";
import { Box, Text, useInput } from "ink";
import type { AgentUIStore, UIState } from "./store.js";
import { MessageList } from "./components/MessageList.js";
import { Welcome } from "./components/Welcome.js";
import { InputBox } from "./components/InputBox.js";
import { StatusBar } from "./components/StatusBar.js";
import { PermissionPrompt } from "./components/PermissionPrompt.js";
import { SessionPicker } from "./components/SessionPicker.js";
import { SetupWizard } from "./components/SetupWizard.js";
import { TaskPanel } from "./components/TaskPanel.js";
import { UpdatePrompt } from "./components/UpdatePrompt.js";
import { performUpdate } from "../updater.js";

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

export interface AppProps {
  store: AgentUIStore;
  onSubmit(line: string): void;
  onAbortTurn(): void;
  onExit(): void;
  /** Session picker callbacks */
  onPickSession(id: string | null): void;
  onSetupDone(): void;
  onCycleMode?(): void;
}

export function App({ store, onSubmit, onAbortTurn, onExit, onPickSession, onSetupDone, onCycleMode }: AppProps) {
  const state: UIState = useSyncExternalStore(store.subscribe, store.getState);
  const { rows, columns } = useTerminalDimensions();
  const exitIntent = useRef<number>(0);
  const [updateStatus, setUpdateStatus] = useState<string | null>(null);
  const updating = useRef(false);

  // Global key routing.
  useInput((input, key) => {
    // 1. Update Prompt handling (when update is available)
    if (state.updateInfo?.hasUpdate && !key.ctrl) {
      if (updating.current) return;
      const lower = input.toLowerCase().trim();
      if (lower === "y") {
        updating.current = true;
        setUpdateStatus(`Updating ${state.updateInfo.packageName} via npm…`);
        performUpdate(state.updateInfo.packageName).then((res) => {
          if (res.success) {
            setUpdateStatus(`✓ Updated to v${state.updateInfo?.latestVersion}! Please restart ruid.`);
            setTimeout(() => {
              store.setUpdateInfo(null);
            }, 3500);
          } else {
            setUpdateStatus(`✖ Update failed: ${res.output.slice(0, 120)}`);
            setTimeout(() => {
              store.setUpdateInfo(null);
            }, 4500);
          }
        });
        return;
      }
      if (lower === "n" || lower === " " || key.escape || key.return) {
        store.setUpdateInfo(null);
        return;
      }
    }

    // 2. Permission Prompt handling
    if (state.pendingPermission && store.respondPermission && !key.ctrl) {
      const lower = input.toLowerCase();
      if (lower === "y" || lower === "n" || lower === "a") {
        store.respondPermission(lower as "y" | "n" | "a");
        return;
      }
    }

    // 3. Global Scrolling Keys (PageUp / PageDown / Home / End)
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

    // 4. Ctrl+C handler
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

  // Calculate remaining height for MessageList
  let overhead = 2; // StatusBar + base margin
  if (state.phase === "picker" || state.phase === "wizard") {
    overhead += 10;
  } else {
    // InputBox border & content + dynamic allowance for command/file palette popups
    overhead += 9;
  }
  if (state.notice) overhead += 1;
  if (state.pendingPermission) {
    // If permission has diff or command, allocate extra height
    overhead += 8;
  }
  if (state.tasks.length > 0) {
    overhead += Math.min(6, state.tasks.length + 2);
  }

  const viewportHeight = Math.max(5, rows - overhead);

  return (
    <Box flexDirection="column" height={rows} paddingX={1}>
      <Box flexDirection="column" flexGrow={1} height={viewportHeight} justifyContent={showWelcome ? "center" : "flex-start"}>
        {showWelcome ? (
          <Welcome connected={state.connected} />
        ) : (
          <MessageList
            messages={state.messages}
            streamingText={state.streamingText}
            viewportHeight={viewportHeight}
            scrollOffset={state.scrollOffset}
            columns={columns}
          />
        )}
      </Box>

      {state.tasks.length > 0 && <TaskPanel tasks={state.tasks} />}

      {state.updateInfo?.hasUpdate && (
        <UpdatePrompt info={state.updateInfo} status={updateStatus} />
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
      ) : (
        <InputBox
          onSubmit={onSubmit}
          disabled={state.phase === "running" || Boolean(state.pendingPermission) || Boolean(state.updateInfo?.hasUpdate)}
          initialValue={state.inputDraft}
          onCycleMode={onCycleMode}
          onScrollUp={() => store.scrollUp(2)}
          onScrollDown={() => store.scrollDown(2)}
          onScrollPageUp={() => store.scrollUp(Math.max(4, Math.floor(rows / 2)))}
          onScrollPageDown={() => store.scrollDown(Math.max(4, Math.floor(rows / 2)))}
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
        msgCount={state.turnCount}
        running={state.phase === "running"}
        mode={state.mode}
        taskCount={state.tasks.length}
        usage={state.sessionUsage}
        lastTurnLatencyMs={state.lastTurnDurationMs}
      />
    </Box>
  );
}

// keep react import used under verbatimModuleSyntax-less configs
void React;
