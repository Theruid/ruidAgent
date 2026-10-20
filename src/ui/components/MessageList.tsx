import React, { memo, useMemo } from "react";
import { Box, Text } from "ink";
import type { ActiveAction, ViewMessage, TurnReceipt } from "../store.js";
import { wrapText, truncateLine } from "../utils/wrap.js";
import { renderMarkdown } from "../utils/markdown.js";
import { formatLatency, formatDuration } from "../utils/pricing.js";
import { ActivityIndicator, Spinner } from "./ActivityIndicator.js";

const USER_HEADER = "❯ you";
const AGENT_HEADER = "✦ agent";

/** First non-empty line of a (possibly long) reasoning block, clipped to width. */
function thoughtPreview(thought: string, width: number): string {
  const line = thought
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  return line ? truncateLine(line, width) : "";
}

const READ_ONLY_TOOLS = new Set([
  "read_file", "list_dir", "glob", "grep",
  "git_status", "git_diff", "git_log",
  "web_search", "web_fetch",
  "task_list", "memory_recall", "memory_list",
]);

export interface LiveHeader {
  action: ActiveAction;
  /** Fallback start time (turn start) when the action carries none. */
  fallbackStart: number;
  tokens?: number;
  columns?: number;
  paused?: boolean;
}

export interface LiveTurn {
  running: boolean;
  action: ActiveAction | null;
  turnStartedAt: number;
  paused?: boolean;
  /**
   * Set by the caller when a tool row is currently pending: its own spinner is
   * already the progress indicator, so the agent-line status is suppressed.
   */
  suppress?: boolean;
  /**
   * True when this turn already printed a `✦ agent` header — later steps then
   * show only the spinner status, without repeating the label.
   */
  headerShown?: boolean;
}

export interface RenderedLine {
  id: string;
  kind:
    | "user-header"
    | "user-body"
    | "thought-body"
    | "thought-preview"
    | "assistant-header"
    | "assistant-body"
    | "tool-pending"
    | "tool-success"
    | "tool-error"
    | "tool-error-detail"
    | "streaming-header"
    | "streaming-thought"
    | "streaming-body"
    | "turn-receipt"
    | "blank";
  text: string;
  /** Present on the streaming header while a turn is in flight. */
  activity?: LiveHeader;
}

export function compileLines(
  messages: ViewMessage[],
  streamingText: string,
  width: number,
  streamingThought?: string,
  streamingThoughtDurationMs?: number,
  live?: LiveTurn,
): RenderedLine[] {
  const contentWidth = Math.max(20, width - 4);
  const lines: RenderedLine[] = [];
  // The agent header is printed once per user turn, not once per assistant
  // block — a turn that interleaves text and tools stays a single "agent" run.
  let headerShown = false;
  /** Opens the turn with its single `✦ agent` header, wherever work starts. */
  const openTurn = (rowId: number): void => {
    if (headerShown) return;
    lines.push({ id: `a-h-${rowId}`, kind: "assistant-header", text: AGENT_HEADER });
    headerShown = true;
  };

  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (i > 0) {
      lines.push({ id: `sep-${m.id}`, kind: "blank", text: "" });
    }

    if (m.kind === "user") {
      headerShown = false;
      lines.push({ id: `u-h-${m.id}`, kind: "user-header", text: USER_HEADER });
      const wrapped = wrapText(m.text, contentWidth);
      for (let j = 0; j < wrapped.length; j++) {
        lines.push({ id: `u-b-${m.id}-${j}`, kind: "user-body", text: wrapped[j] });
      }
    } else if (m.kind === "assistant") {
      // Turn receipt (compact stats line, no header)
      if (m.turnReceipt) {
        const r = m.turnReceipt;
        const parts: string[] = [];
        if (r.durationMs > 0) parts.push(formatDuration(r.durationMs));
        if (r.filesChanged > 0) parts.push(`${r.filesChanged} file${r.filesChanged === 1 ? "" : "s"} modified`);
        if (r.commandsRun > 0) parts.push(`${r.commandsRun} command${r.commandsRun === 1 ? "" : "s"} run`);
        if (r.costDelta > 0) parts.push(`$${r.costDelta.toFixed(3)}`);
        lines.push({
          id: `receipt-${m.id}`,
          kind: "turn-receipt",
          text: `⚡ ${parts.join(" · ")}`,
        });
        continue;
      }

      openTurn(m.id);
      if (m.thought) {
        const durStr = m.thoughtDurationMs ? ` for ${formatLatency(m.thoughtDurationMs)}` : "";
        lines.push({
          id: `a-t-${m.id}`,
          kind: "thought-body",
          text: `◦ thought${durStr}`,
        });
        const preview = thoughtPreview(m.thought, contentWidth - 2);
        if (preview) {
          lines.push({ id: `a-tp-${m.id}`, kind: "thought-preview", text: preview });
        }
      }
      if (m.text) {
        const mdLines = renderMarkdown(m.text, contentWidth);
        for (let j = 0; j < mdLines.length; j++) {
          lines.push({ id: `a-b-${m.id}-${j}`, kind: "assistant-body", text: mdLines[j].text });
        }
      }
    } else if (m.kind === "tool") {
      openTurn(m.id);
      // Check if this starts a run of 3+ consecutive successful read-only tools
      const isReadOnly = !m.pending && !m.toolError && m.toolName && READ_ONLY_TOOLS.has(m.toolName);
      if (isReadOnly) {
        let runEnd = i;
        while (
          runEnd + 1 < messages.length &&
          messages[runEnd + 1].kind === "tool" &&
          !messages[runEnd + 1].pending &&
          !messages[runEnd + 1].toolError &&
          messages[runEnd + 1].toolName &&
          READ_ONLY_TOOLS.has(messages[runEnd + 1].toolName!)
        ) {
          runEnd++;
        }
        const runLen = runEnd - i + 1;
        if (runLen >= 3) {
          // Collapse this run into a single summary line
          const toolCounts = new Map<string, number>();
          let totalDuration = 0;
          for (let k = i; k <= runEnd; k++) {
            const tm = messages[k];
            const name = tm.toolMeta?.badgeTitle || tm.toolName || "tool";
            toolCounts.set(name, (toolCounts.get(name) || 0) + 1);
            if (tm.toolMeta?.durationMs) totalDuration += tm.toolMeta.durationMs;
          }
          const parts = Array.from(toolCounts.entries()).map(([name, count]) => `${count} ${name}`);
          const durStr = totalDuration > 0 ? ` · ${formatLatency(totalDuration)}` : "";
          lines.push({
            id: `t-group-${m.id}`,
            kind: "tool-success",
            text: `✔ Explored ${runLen} files (${parts.join(", ")})${durStr}`,
          });
          i = runEnd; // skip past the group
          continue;
        }
      }

      // Render individual tool line (non-grouped)
      const toolName = m.toolMeta?.badgeTitle || m.toolName || "tool";
      const detail = m.toolMeta?.badgeDetail || "";
      const durationStr = m.toolMeta?.durationMs ? ` · ${formatLatency(m.toolMeta.durationMs)}` : "";

      if (m.pending) {
        lines.push({
          id: `t-${m.id}`,
          kind: "tool-pending",
          text: `${toolName}${detail ? ` ${detail}` : ""}`,
        });
      } else if (m.toolError) {
        lines.push({
          id: `t-${m.id}`,
          kind: "tool-error",
          text: `✖ ${toolName}${detail ? ` ${detail}` : ""}${durationStr}`,
        });
        if (m.text) {
          const errWrapped = wrapText(m.text, contentWidth - 4);
          for (let j = 0; j < errWrapped.length; j++) {
            lines.push({
              id: `t-err-${m.id}-${j}`,
              kind: "tool-error-detail",
              text: `  ${errWrapped[j]}`,
            });
          }
        }
      } else {
        lines.push({
          id: `t-${m.id}`,
          kind: "tool-success",
          text: `✔ ${toolName}${detail ? ` ${detail}` : ""}${durationStr}`,
        });
      }
    }
  }

  // While a tool row is still pending its own spinner already reports progress,
  // so the live header would duplicate it.
  const hasPendingTool = messages.some((m) => m.kind === "tool" && m.pending);
  const liveHeader: LiveHeader | undefined =
    live?.running && !live.suppress && !hasPendingTool
      ? {
          action: live.action ?? { name: "Working", startedAt: live.turnStartedAt },
          fallbackStart: live.turnStartedAt,
          tokens: Math.ceil(streamingText.length / 4) || undefined,
          columns: width,
          paused: live.paused,
        }
      : undefined;

  if (streamingThought || streamingText || liveHeader) {
    if (messages.length > 0) {
      lines.push({ id: "sep-streaming", kind: "blank", text: "" });
    }
    // Only the first output of a turn carries the `✦ agent` label.
    const showAgentLabel = !(live?.headerShown ?? headerShown);
    lines.push({
      id: "s-h",
      kind: "streaming-header",
      text: showAgentLabel ? AGENT_HEADER : "",
      activity: liveHeader,
    });

    if (streamingThought && !streamingText) {
      // Show the tail of the live reasoning so the screen keeps moving while
      // the model thinks, instead of one static "thinking…" line.
      const wrapped = wrapText(streamingThought.trim(), contentWidth - 2).filter((l) => l.trim().length > 0);
      const tail = wrapped.slice(-4);
      if (tail.length === 0) {
        lines.push({ id: "s-th-b", kind: "streaming-thought", text: "◦ thinking…" });
      }
      for (let j = 0; j < tail.length; j++) {
        lines.push({ id: `s-th-${j}`, kind: "streaming-thought", text: tail[j] });
      }
    } else if (streamingThought && streamingText) {
      const durStr = streamingThoughtDurationMs ? ` for ${formatLatency(streamingThoughtDurationMs)}` : "";
      lines.push({
        id: "s-th-done",
        kind: "thought-body",
        text: `◦ thought${durStr}`,
      });
    }

    if (streamingText) {
      const mdLines = renderMarkdown(streamingText, contentWidth);
      for (let j = 0; j < mdLines.length; j++) {
        const isLast = j === mdLines.length - 1;
        lines.push({
          id: `s-b-${j}`,
          kind: "streaming-body",
          text: mdLines[j].text + (isLast ? " ▌" : ""),
        });
      }
    }
  }

  return lines;
}

const MessageLine = memo(function MessageLine({ line }: { line: RenderedLine }) {
  switch (line.kind) {
    case "user-header":
      return (
        <Box paddingLeft={1}>
          <Text color="blue" bold>
            {line.text}
          </Text>
        </Box>
      );
    case "user-body":
      return (
        <Box paddingLeft={1}>
          <Text>{line.text}</Text>
        </Box>
      );
    case "thought-body":
      return (
        <Box paddingLeft={2}>
          <Text dimColor>
            {line.text}
          </Text>
        </Box>
      );
    case "thought-preview":
      return (
        <Box paddingLeft={3}>
          <Text dimColor italic>
            {line.text}
          </Text>
        </Box>
      );
    case "assistant-header":
      return (
        <Box paddingLeft={1}>
          <Text color="cyan" bold>
            {line.text}
          </Text>
        </Box>
      );
    case "assistant-body":
      return (
        <Box paddingLeft={1}>
          <Text>{line.text}</Text>
        </Box>
      );
    case "streaming-header":
      if (!line.text) {
        return (
          <Box paddingLeft={3}>
            {line.activity && (
              <ActivityIndicator
                label={line.activity.action.name}
                detail={line.activity.action.detail}
                startedAt={line.activity.action.startedAt || line.activity.fallbackStart || Date.now()}
                tokens={line.activity.tokens}
                columns={line.activity.columns}
                paused={line.activity.paused}
              />
            )}
          </Box>
        );
      }
      return (
        <Box paddingLeft={1}>
          <Text color="cyan" bold>
            {line.text}
          </Text>
          {line.activity && (
            <Box paddingLeft={1}>
              <ActivityIndicator
                label={line.activity.action.name}
                detail={line.activity.action.detail}
                startedAt={line.activity.action.startedAt || line.activity.fallbackStart || Date.now()}
                tokens={line.activity.tokens}
                columns={line.activity.columns}
                paused={line.activity.paused}
              />
            </Box>
          )}
        </Box>
      );
    case "streaming-thought":
      return (
        <Box paddingLeft={2}>
          <Text color="yellow">
            {line.text}
          </Text>
        </Box>
      );
    case "streaming-body":
      return (
        <Box paddingLeft={1}>
          <Text>{line.text}</Text>
        </Box>
      );
    case "tool-pending":
      return (
        <Box paddingLeft={2}>
          <Spinner color="yellow" />
          <Text color="yellow"> {line.text}…</Text>
        </Box>
      );
    case "tool-success":
      return (
        <Box paddingLeft={2}>
          <Text color="green">✔ </Text>
          <Text dimColor>{line.text.slice(2)}</Text>
        </Box>
      );
    case "tool-error":
      return (
        <Box paddingLeft={2}>
          <Text color="red">{line.text}</Text>
        </Box>
      );
    case "tool-error-detail":
      return (
        <Box paddingLeft={2}>
          <Text color="red" dimColor>
            {line.text}
          </Text>
        </Box>
      );
    case "turn-receipt":
      return (
        <Box paddingLeft={2}>
          <Text color="cyan" dimColor>
            {line.text}
          </Text>
        </Box>
      );
    case "blank":
      return <Box height={1} />;
    default:
      return null;
  }
});

export function MessageList({
  messages,
  streamingText,
  streamingThought,
  streamingThoughtDurationMs,
  viewportHeight,
  scrollOffset,
  columns,
  running = false,
  activeAction = null,
  turnStartedAt = 0,
  paused = false,
}: {
  messages: ViewMessage[];
  streamingText: string;
  streamingThought?: string;
  streamingThoughtDurationMs?: number;
  viewportHeight: number;
  scrollOffset: number;
  columns: number;
  /** True while a turn is in flight — shows the live indicator on the agent line. */
  running?: boolean;
  activeAction?: ActiveAction | null;
  turnStartedAt?: number;
  paused?: boolean;
}) {
  const live = useMemo<LiveTurn>(() => {
    // Has this turn already printed an agent header for an earlier row?
    let headerShown = false;
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.kind === "user") break;
      if (m.kind === "tool" || (m.kind === "assistant" && !m.turnReceipt)) {
        headerShown = true;
        break;
      }
    }
    return {
      running,
      action: activeAction,
      turnStartedAt,
      paused,
      suppress: messages.some((m) => m.kind === "tool" && m.pending),
      headerShown,
    };
  }, [running, activeAction, turnStartedAt, paused, messages]);

  // Committed history only changes when a row is added, so it is compiled once
  // per structural change. Streaming deltas recompile only the live tail —
  // otherwise every token would re-render markdown for the entire transcript.
  const committedLines = useMemo(() => compileLines(messages, "", columns), [messages, columns]);
  const streamingLines = useMemo(() => {
    const block = compileLines([], streamingText, columns, streamingThought, streamingThoughtDurationMs, live);
    if (block.length === 0) return [];
    return messages.length > 0
      ? [{ id: "sep-streaming", kind: "blank" as const, text: "" }, ...block]
      : block;
  }, [streamingText, streamingThought, streamingThoughtDurationMs, columns, messages.length, live]);
  const allLines = useMemo(
    () => (streamingLines.length > 0 ? [...committedLines, ...streamingLines] : committedLines),
    [committedLines, streamingLines],
  );
  const totalLines = allLines.length;

  const showIndicators = scrollOffset > 0;
  // Reserve space for indicator headers/footers if scrolled
  const indicatorAllowance = showIndicators ? 2 : 0;
  const contentHeight = Math.max(1, viewportHeight - indicatorAllowance);

  const maxScroll = Math.max(0, totalLines - contentHeight);
  const clampedOffset = Math.min(Math.max(0, scrollOffset), maxScroll);

  const startIdx = Math.max(0, totalLines - contentHeight - clampedOffset);
  const endIdx = Math.min(totalLines, startIdx + contentHeight);
  const visibleLines = allLines.slice(startIdx, endIdx);

  const linesAbove = startIdx;
  const linesBelow = totalLines - endIdx;

  return (
    <Box flexDirection="column" height={viewportHeight} justifyContent="flex-start">
      {clampedOffset > 0 && linesAbove > 0 && (
        <Box paddingLeft={1}>
          <Text dimColor>
            ↑ {linesAbove} lines above · [PgUp/PgDn to scroll, End for bottom]
          </Text>
        </Box>
      )}

      {visibleLines.map((line) => (
        <MessageLine key={line.id} line={line} />
      ))}

      {clampedOffset > 0 && (
        <Box paddingLeft={1}>
          <Text color="yellow">
            ↓ {linesBelow} lines below [Scrolled view · type or press End to return to bottom]
          </Text>
        </Box>
      )}
    </Box>
  );
}
