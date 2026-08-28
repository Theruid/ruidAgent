import { describe, it } from "node:test";
import assert from "node:assert";
import { parseStream, translateMessage, createAnthropicProvider, ANTHROPIC_MODELS } from "./anthropic.js";
import type { LLMMessage } from "./types.js";

describe("Anthropic Adapter & Stream Parsing", () => {
  it("translates canonical messages to Anthropic wire format", () => {
    const msg: LLMMessage = {
      role: "assistant",
      content: [
        { type: "text", text: "Reading file..." },
        { type: "tool_call", id: "call_123", name: "read_file", input: { path: "README.md" } },
      ],
    };

    const translated = translateMessage(msg, false);
    assert.strictEqual(translated.role, "assistant");
    assert.strictEqual(translated.content.length, 2);
    assert.deepStrictEqual(translated.content[0], { type: "text", text: "Reading file..." });
    assert.deepStrictEqual(translated.content[1], {
      type: "tool_use",
      id: "call_123",
      name: "read_file",
      input: { path: "README.md" },
    });
  });

  it("parses streaming SSE response chunks including thinking deltas", async () => {
    const sseChunks = [
      'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":15}}}\n\n',
      'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":""}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"Analyzing problem"}}\n\n',
      'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
      'event: content_block_start\ndata: {"type":"content_block_start","index":1,"content_block":{"type":"text","text":""}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"Hello world"}}\n\n',
      'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":5}}\n\n',
      'event: message_stop\ndata: {"type":"message_stop"}\n\n',
    ];

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of sseChunks) {
          controller.enqueue(new TextEncoder().encode(chunk));
        }
        controller.close();
      },
    });

    const events = [];
    for await (const event of parseStream(stream)) {
      events.push(event);
    }

    assert(events.some((e) => e.type === "thought_delta" && e.text === "Analyzing problem"));
    assert(events.some((e) => e.type === "text_delta" && e.text === "Hello world"));
    assert(events.some((e) => e.type === "message_delta" && e.stopReason === "end_turn"));
  });

  it("exposes capabilities for Anthropic models", () => {
    const provider = createAnthropicProvider({
      type: "anthropic",
      apiKey: "test-key",
    });
    const caps = provider.capabilities("claude-sonnet-5");
    assert.strictEqual(caps.supportsThinking, true);
    assert.strictEqual(caps.supportsPromptCaching, true);
    assert.strictEqual(caps.contextWindow, 200_000);
  });
});
