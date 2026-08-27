import { describe, it } from "node:test";
import assert from "node:assert";
import { buildSubagentSystemPrompt } from "./subagent.js";
import { pipeline, parallel } from "./orchestration.js";
import type { LLMProvider } from "../providers/types.js";

describe("Subagents & Orchestration Primitives", () => {
  it("builds specialized system prompts with schema enforcement", () => {
    const prompt = buildSubagentSystemPrompt("explore", "/test/workspace", "linux", {
      type: "object",
      properties: {
        findings: { type: "array", items: { type: "string" } },
      },
      required: ["findings"],
    });

    assert.match(prompt, /ROLE: EXPLORE/);
    assert.match(prompt, /<structured_output_requirement>/);
    assert.match(prompt, /"findings"/);
  });

  it("executes sequential pipeline chain with mocked provider", async () => {
    const mockProvider: LLMProvider = {
      name: "mock-llm",
      config: { type: "openai" },
      async *complete(req) {
        const lastUser = req.messages.find((m) => m.role === "user");
        const userText =
          lastUser?.content.find((c): c is Extract<typeof c, { type: "text" }> => c.type === "text")
            ?.text ?? "";
        yield { type: "text_delta", text: `processed(${userText})` };
        yield { type: "message_delta", stopReason: "stop" };
      },
    };

    const result = await pipeline(
      "initial-data",
      [
        {
          role: "explore",
          promptTemplate: (input) => `step1: ${input}`,
        },
        {
          role: "reviewer",
          promptTemplate: (input) => `step2: ${input}`,
        },
      ],
      {
        provider: mockProvider,
        model: "mock-model",
        workspaceRoot: process.cwd(),
      }
    );

    assert.strictEqual(result, "processed(step2: processed(step1: initial-data))");
  });

  it("executes parallel subagents concurrently", async () => {
    const mockProvider: LLMProvider = {
      name: "mock-llm",
      config: { type: "openai" },
      async *complete(req) {
        const lastUser = req.messages.find((m) => m.role === "user");
        const userText =
          lastUser?.content.find((c): c is Extract<typeof c, { type: "text" }> => c.type === "text")
            ?.text ?? "";
        yield { type: "text_delta", text: `result-for:${userText}` };
        yield { type: "message_delta", stopReason: "stop" };
      },
    };

    const results = await parallel(
      [
        { role: "explore", prompt: "task-A" },
        { role: "coder", prompt: "task-B" },
      ],
      {
        provider: mockProvider,
        model: "mock-model",
        workspaceRoot: process.cwd(),
        options: { concurrency: 2 },
      }
    );

    assert.strictEqual(results.length, 2);
    assert.strictEqual(results[0].result, "result-for:task-A");
    assert.strictEqual(results[1].result, "result-for:task-B");
  });
});
