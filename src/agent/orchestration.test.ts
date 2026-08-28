import { describe, it } from "node:test";
import assert from "node:assert";
import { pipeline, parallel } from "./orchestration.js";
import type { LLMProvider } from "../providers/types.js";

describe("Orchestration (Pipeline & Parallel)", () => {
  const mockProvider: LLMProvider = {
    name: "mock",
    config: { type: "openai" },
    async *complete(req) {
      const prompt = req.messages.find((m) => m.role === "user")?.content[0];
      const text = prompt && prompt.type === "text" ? prompt.text : "";
      yield { type: "text_delta", text: `Processed: ${text}` };
      yield { type: "message_delta", stopReason: "end_turn" };
    },
  };

  it("runs sequential pipeline passing data forward", async () => {
    const result = await pipeline(
      "Initial Task",
      [
        {
          role: "explore",
          promptTemplate: (input) => `Step 1 on: ${input}`,
        },
        {
          role: "coder",
          promptTemplate: (input) => `Step 2 on: ${input}`,
        },
      ],
      {
        provider: mockProvider,
        model: "mock-model",
        workspaceRoot: process.cwd(),
      }
    );

    assert(typeof result === "string");
    assert(result.includes("Step 2 on:"));
  });

  it("runs parallel batches concurrently", async () => {
    const tasks = [
      { role: "explore" as const, prompt: "Task A" },
      { role: "explore" as const, prompt: "Task B" },
    ];

    const results = await parallel(tasks, {
      provider: mockProvider,
      model: "mock-model",
      workspaceRoot: process.cwd(),
      options: { concurrency: 2 },
    });

    assert.strictEqual(results.length, 2);
    assert.strictEqual(results[0].index, 0);
    assert.strictEqual(results[1].index, 1);
  });
});
