import type { LLMMessage } from "../providers/types.js";

/**
 * Fast character-to-token estimator (~4 characters per token).
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function estimateMessageTokens(message: LLMMessage): number {
  let total = 4; // per-message overhead
  for (const c of message.content) {
    if (c.type === "text") {
      total += estimateTokens(c.text);
    } else if (c.type === "tool_call") {
      total += estimateTokens(c.name) + estimateTokens(JSON.stringify(c.input ?? {}));
    } else if (c.type === "tool_result") {
      total += estimateTokens(c.content);
    }
  }
  return total;
}

export function estimateHistoryTokens(messages: LLMMessage[]): number {
  return messages.reduce((acc, m) => acc + estimateMessageTokens(m), 0);
}

const MAX_COMPACTED_TOOL_RESULT_LEN = 300;

/**
 * Compacts older tool results in message history to preserve context space
 * while keeping recent turns intact.
 *
 * Keeps the most recent `preserveRecentTurns` tool results uncompacted.
 */
export function compactHistory(
  messages: LLMMessage[],
  preserveRecentTurns = 4
): LLMMessage[] {
  // Count tool results from newest to oldest
  let toolResultTurnCount = 0;
  const cutoffIndices = new Set<number>();

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    const hasToolResult = msg.content.some((c) => c.type === "tool_result");
    if (hasToolResult) {
      toolResultTurnCount++;
      if (toolResultTurnCount > preserveRecentTurns) {
        cutoffIndices.add(i);
      }
    }
  }

  if (cutoffIndices.size === 0) return messages;

  return messages.map((msg, index) => {
    if (!cutoffIndices.has(index)) return msg;

    const newContent = msg.content.map((c) => {
      if (c.type === "tool_result" && c.content.length > MAX_COMPACTED_TOOL_RESULT_LEN) {
        const lines = c.content.split("\n");
        const summary =
          lines.length > 6
            ? `${lines.slice(0, 3).join("\n")}\n... [${lines.length - 6} lines truncated for context compaction] ...\n${lines.slice(-3).join("\n")}`
            : c.content.slice(0, MAX_COMPACTED_TOOL_RESULT_LEN) + " ... [truncated]";

        return {
          ...c,
          content: summary,
        };
      }
      return c;
    });

    return {
      ...msg,
      content: newContent,
    };
  });
}
