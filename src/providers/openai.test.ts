import { describe, it } from "node:test";
import assert from "node:assert";
import { parseStream, translateMessage, listModels, createOpenAIProvider } from "./openai.js";
import type { LLMMessage } from "./types.js";
import http from "node:http";

describe("OpenAI Provider & Adapter", () => {
  it("translates tool calls and results to OpenAI wire format", () => {
    const msg: LLMMessage = {
      role: "assistant",
      content: [
        { type: "text", text: "Executing command" },
        { type: "tool_call", id: "call_abc", name: "bash", input: { command: "ls" } },
      ],
    };

    const translated = translateMessage(msg);
    assert.strictEqual(translated.role, "assistant");
    assert.strictEqual(translated.content, "Executing command");
    assert.strictEqual(translated.tool_calls?.length, 1);
    assert.strictEqual(translated.tool_calls[0].id, "call_abc");
    assert.strictEqual(translated.tool_calls[0].function.name, "bash");
  });

  it("fetches and dedupes models list from /v1/models endpoint", async () => {
    const server = http.createServer((req, res) => {
      if (req.url === "/v1/models") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            data: [
              { id: "gpt-4o" },
              { id: "gpt-4o-mini" },
              { id: "gpt-4o" },
            ],
          })
        );
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    await new Promise<void>((r) => server.listen(0, r));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;

    try {
      const models = await listModels({
        type: "openai",
        baseUrl: `http://localhost:${port}/v1`,
        apiKey: "test",
      });
      assert.deepStrictEqual(models, ["gpt-4o", "gpt-4o-mini"]);
    } finally {
      server.close();
    }
  });

  it("exposes capabilities for reasoning models and standard models", () => {
    const provider = createOpenAIProvider({
      type: "openai",
      apiKey: "test",
    });
    const reasoningCaps = provider.capabilities("o3-mini");
    assert.strictEqual(reasoningCaps.supportsThinking, true);
    assert.strictEqual(reasoningCaps.supportsReasoningEffort, true);

    const chatCaps = provider.capabilities("gpt-4o");
    assert.strictEqual(chatCaps.supportsThinking, false);
    assert.strictEqual(chatCaps.supportsStructuredOutput, true);
  });
});
