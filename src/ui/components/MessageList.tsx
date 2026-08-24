import React, { memo } from "react";
import { Box, Text } from "ink";
import type { ViewMessage } from "../store.js";
import { wrapText } from "../utils/wrap.js";
import { renderMarkdown } from "../utils/markdown.js";
import { formatLatency } from "../utils/pricing.js";

export interface RenderedLine {
  id: string;
  kind:
    | "user-header"
    | "user-body"
    | "assistant-header"
    | "assistant-body"
    | "tool-pending"
    | "tool-success"
    | "tool-error"
    | "tool-error-detail"
    | "streaming-header"
    | "streaming-body"
    | "blank";
  text: string;
}

export function compileLines(
  messages: ViewMessage[],
  streamingText: string,
  width: number,
): RenderedLine[] {
  const contentWidth = Math.max(20, width - 4);
  const lines: RenderedLine[] = [];

  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (i > 0) {
      lines.push({ id: `sep-${m.id}`, kind: "blank", text: "" });
    }

    if (m.kind === "user") {
      lines.push({ id: `u-h-${m.id}`, kind: "user-header", text: "you" });
      const wrapped = wrapText(m.text, contentWidth);
      for (let j = 0; j < wrapped.length; j++) {
        lines.push({ id: `u-b-${m.id}-${j}`, kind: "user-body", text: wrapped[j] });
      }
    } else if (m.kind === "assistant") {
      lines.push({ id: `a-h-${m.id}`, kind: "assistant-header", text: "agent" });
      const mdLines = renderMarkdown(m.text, contentWidth);
      for (let j = 0; j < mdLines.length; j++) {
        lines.push({ id: `a-b-${m.id}-${j}`, kind: "assistant-body", text: mdLines[j].text });
      }
    } else if (m.kind === "tool") {
      const toolName = m.toolMeta?.badgeTitle || m.toolName || "tool";
      const detail = m.toolMeta?.badgeDetail || "";
      const durationStr = m.toolMeta?.durationMs ? ` · ${formatLatency(m.toolMeta.durationMs)}` : "";

      if (m.pending) {
        lines.push({
          id: `t-${m.id}`,
          kind: "tool-pending",
          text: `● ${toolName}${detail ? ` ${detail}` : ""}…`,
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

  if (streamingText) {
    if (messages.length > 0) {
      lines.push({ id: "sep-streaming", kind: "blank", text: "" });
    }
    lines.push({ id: "s-h", kind: "streaming-header", text: "agent" });
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
      return (
        <Box paddingLeft={1}>
          <Text color="cyan" bold>
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
          <Text color="yellow">{line.text}</Text>
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
    case "blank":
      return <Box height={1} />;
    default:
      return null;
  }
});

export function MessageList({
  messages,
  streamingText,
  viewportHeight,
  scrollOffset,
  columns,
}: {
  messages: ViewMessage[];
  streamingText: string;
  viewportHeight: number;
  scrollOffset: number;
  columns: number;
}) {
  const allLines = compileLines(messages, streamingText, columns);
  const totalLines = allLines.length;

  const height = Math.max(1, viewportHeight);
  const maxScroll = Math.max(0, totalLines - height);
  const clampedOffset = Math.min(Math.max(0, scrollOffset), maxScroll);

  const startIdx = Math.max(0, totalLines - height - clampedOffset);
  const endIdx = Math.min(totalLines, startIdx + height);
  const visibleLines = allLines.slice(startIdx, endIdx);

  const linesAbove = startIdx;
  const linesBelow = totalLines - endIdx;

  return (
    <Box flexDirection="column" height={height} flexGrow={1} justifyContent="flex-start">
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
