import type { LLMMessage, LLMProvider } from "../providers/types.js";

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

const MAX_COMPACTED_TOOL_RESULT_LEN = 2500;

let tokenCalibrationRatio = 1.0;

/**
 * Calibrates token estimation ratio using reported provider input tokens via EMA smoothing.
 */
export function updateTokenCalibration(estimatedTokens: number, actualInputTokens: number): void {
  if (estimatedTokens > 0 && actualInputTokens > 0) {
    const ratio = actualInputTokens / estimatedTokens;
    // EMA smoothing factor alpha = 0.2
    tokenCalibrationRatio = 0.8 * tokenCalibrationRatio + 0.2 * ratio;
  }
}

export function getCalibratedTokenEstimate(rawEstimate: number): number {
  return Math.ceil(rawEstimate * tokenCalibrationRatio);
}

/**
 * Phase 1: Micro-compacts older tool results in message history to preserve context space
 * while keeping recent turns and critical outputs intact.
 */
export function microCompactHistory(
  messages: LLMMessage[],
  preserveRecentTurns = 4
): LLMMessage[] {
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
        const lines = c.content.split(/\r?\n/);
        const summary =
          lines.length > 20
            ? `${lines.slice(0, 10).join("\n")}\n... [${lines.length - 20} lines compacted to preserve context budget] ...\n${lines.slice(-10).join("\n")}`
            : c.content.slice(0, MAX_COMPACTED_TOOL_RESULT_LEN) + "\n... [truncated for context compaction; re-read if needed]";

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

// Backwards-compatible alias
export const compactHistory = microCompactHistory;

/**
 * Phase 2: Semantic summarization of older turns when conversation history nears token limits.
 * Compaction cut points strictly respect cache breakpoint boundaries (keeping recent turns intact).
 */
export async function semanticSummarizeHistory(
  messages: LLMMessage[],
  provider: LLMProvider,
  model: string,
  preserveRecentTurns = 4,
  signal?: AbortSignal
): Promise<LLMMessage[]> {
  if (messages.length <= preserveRecentTurns * 2) {
    return microCompactHistory(messages, preserveRecentTurns);
  }

  // Identify breakpoint cut point
  const cutIndex = Math.max(1, messages.length - preserveRecentTurns * 2);
  const turnsToSummarize = messages.slice(0, cutIndex);
  const turnsToPreserve = messages.slice(cutIndex);

  // Extract structured conversation log for summarization
  const historyText = turnsToSummarize
    .map((m) => {
      const texts = m.content
        .map((c) => (c.type === "text" ? c.text : c.type === "tool_result" ? `[Tool Result: ${c.content.slice(0, 150)}]` : `[Tool Call: ${c.name}]`))
        .join(" ");
      return `${m.role.toUpperCase()}: ${texts}`;
    })
    .join("\n");

  const prompt = `You are a context compaction engine for a software development agent.
Summarize the key facts, file modifications, errors solved, decisions made, and active task progress from this earlier conversation:

${historyText}

Output a dense technical summary in structured Markdown inside <context_summary> tags. Include exact file paths and function names where applicable.`;

  let summary = "";
  try {
    for await (const evt of provider.complete({
      system: "You are a concise, accurate context compaction system.",
      messages: [{ role: "user", content: [{ type: "text", text: prompt }] }],
      tools: [],
      model,
      signal,
    })) {
      if (evt.type === "text_delta") {
        summary += evt.text;
      }
    }
  } catch {
    // If LLM summarization fails, fall back to micro-compaction
    return microCompactHistory(messages, preserveRecentTurns);
  }

  const summaryMessage: LLMMessage = {
    role: "user",
    content: [
      {
        type: "text",
        text: summary.trim() || "<context_summary>\nPrior conversation turns summarized to conserve context.\n</context_summary>",
      },
    ],
  };

  return [summaryMessage, ...turnsToPreserve];
}
