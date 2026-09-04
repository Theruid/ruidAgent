import { describe, it } from "node:test";
import assert from "node:assert";
import {
  estimateTokens,
  estimateHistoryTokens,
  microCompactHistory,
  semanticSummarizeHistory,
} from "./context.js";
import type { LLMMessage, LLMProvider } from "../providers/types.js";

describe("Context Compaction & Token Estimation", () => {
  it("estimates tokens based on characters (~4 chars/token)", () => {
    assert.strictEqual(estimateTokens("1234"), 1);
    assert.strictEqual(estimateTokens("12345678"), 2);
  });

  it("micro-compacts older tool results beyond recent threshold", () => {
    const longContent = "line 1\nline 2\nline 3\nline 4\nline 5\nline 6\nline 7\nline 8\nline 9\nline 10".repeat(50);
    const messages: LLMMessage[] = [
      {
        role: "user",
        content: [{ type: "text", text: "step 1" }],
      },
      {
        role: "assistant",
        content: [{ type: "tool_result", toolCallId: "call_1", content: longContent }],
      },
      {
        role: "user",
        content: [{ type: "text", text: "step 2" }],
      },
      {
        role: "assistant",
        content: [{ type: "tool_result", toolCallId: "call_2", content: longContent }],
      },
      {
        role: "user",
        content: [{ type: "text", text: "step 3" }],
      },
      {
        role: "assistant",
        content: [{ type: "tool_result", toolCallId: "call_3", content: longContent }],
      },
    ];

    // Preserve 1 recent turn with tool results
    const compacted = microCompactHistory(messages, 1);

    assert.strictEqual(compacted.length, 6);
    // Old tool result is truncated
    const oldRes = compacted[1].content[0];
    assert.strictEqual(oldRes.type, "tool_result");
    if (oldRes.type === "tool_result") {
      assert.match(oldRes.content, /compacted to preserve context budget|truncated for context compaction/);
    }

    // Recent tool result remains intact
    const recentRes = compacted[5].content[0];
    assert.strictEqual(recentRes.type, "tool_result");
    if (recentRes.type === "tool_result") {
      assert.strictEqual(recentRes.content, longContent);
    }
  });

  it("performs semantic summarization on conversation exceeding threshold", async () => {
    const mockProvider: LLMProvider = {
      name: "mock-llm",
      config: { type: "openai" },
      async *complete() {
        yield { type: "text_delta", text: "<context_summary>\nUser created auth.ts and configured JWT verification.\n</context_summary>" };
        yield { type: "message_delta", stopReason: "stop" };
      },
    };

    const messages: LLMMessage[] = [
      { role: "user", content: [{ type: "text", text: "Turn 1" }] },
      { role: "assistant", content: [{ type: "text", text: "Reply 1" }] },
      { role: "user", content: [{ type: "text", text: "Turn 2" }] },
      { role: "assistant", content: [{ type: "text", text: "Reply 2" }] },
      { role: "user", content: [{ type: "text", text: "Turn 3" }] },
      { role: "assistant", content: [{ type: "text", text: "Reply 3" }] },
      { role: "user", content: [{ type: "text", text: "Turn 4" }] },
      { role: "assistant", content: [{ type: "text", text: "Reply 4" }] },
      { role: "user", content: [{ type: "text", text: "Turn 5" }] },
      { role: "assistant", content: [{ type: "text", text: "Reply 5" }] },
    ];

    const summarized = await semanticSummarizeHistory(messages, mockProvider, "mock-model", 2);

    assert.strictEqual(summarized[0].role, "user");
    const summaryText = summarized[0].content[0];
    assert.strictEqual(summaryText.type, "text");
    if (summaryText.type === "text") {
      assert.match(summaryText.text, /<context_summary>/);
    }
    // Preserves recent turns
    assert.strictEqual(summarized.length, 5); // 1 summary msg + 4 recent msgs
  });
});
