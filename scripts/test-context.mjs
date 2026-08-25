import assert from "node:assert";
import { compactHistory, estimateTokens, estimateHistoryTokens } from "../dist/agent/context.js";

async function testContext() {
  const messages = [
    {
      role: "user",
      content: [{ type: "text", text: "Read a huge file" }],
    },
    {
      role: "assistant",
      content: [{ type: "tool_call", id: "c1", name: "read_file", input: { path: "big.txt" } }],
    },
    {
      role: "user",
      content: [
        {
          type: "tool_result",
          toolCallId: "c1",
          content: "A".repeat(5000),
          isError: false,
        },
      ],
    },
    // More recent turns
    {
      role: "assistant",
      content: [{ type: "tool_call", id: "c2", name: "read_file", input: { path: "small.txt" } }],
    },
    {
      role: "user",
      content: [
        {
          type: "tool_result",
          toolCallId: "c2",
          content: "B".repeat(5000),
          isError: false,
        },
      ],
    },
  ];

  const beforeTokens = estimateHistoryTokens(messages);
  // Compact with preserveRecentTurns = 1 so c1 gets compacted and c2 stays intact
  const compacted = compactHistory(messages, 1);
  const afterTokens = estimateHistoryTokens(compacted);

  assert(afterTokens < beforeTokens, "Compacted history should use fewer tokens");
  assert(
    compacted[2].content[0].content.includes("truncated"),
    "Old tool result should be truncated"
  );
  assert.strictEqual(
    compacted[4].content[0].content.length,
    5000,
    "Recent tool result should be preserved"
  );

  console.log("PASS: context compaction tests succeeded");
}

testContext().catch((e) => {
  console.error("FAIL:", e);
  process.exit(1);
});
