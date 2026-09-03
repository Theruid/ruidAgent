import { describe, it } from "node:test";
import assert from "node:assert";
import { buildSubagentSystemPrompt } from "./subagent.js";
import { pipeline, parallel, runEvaluatorOptimizer, workflowDAG } from "./orchestration.js";
import {
  subagentParallelTool,
  subagentOptimizeTool,
  subagentWorkflowTool,
} from "../tools/subagent.js";
import { Workspace } from "../tools/fs.js";
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

  it("omits prompt boilerplate when provider supports native structured output", () => {
    const prompt = buildSubagentSystemPrompt(
      "explore",
      "/test/workspace",
      "linux",
      {
        type: "object",
        properties: {
          findings: { type: "array", items: { type: "string" } },
        },
        required: ["findings"],
      },
      true
    );

    assert.match(prompt, /ROLE: EXPLORE/);
    assert.doesNotMatch(prompt, /<structured_output_requirement>/);
  });

  it("enforces strict invariants in coder prompt", () => {
    const prompt = buildSubagentSystemPrompt("coder", "/test/workspace", "win32");
    assert.match(prompt, /ROLE: CODER/);
    assert.match(prompt, /Strict Invariant: NEVER leave placeholder comments/);
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

  it("executes subagent_parallel tool and formats output", async () => {
    const mockProvider: LLMProvider = {
      name: "mock-llm",
      config: { type: "openai" },
      async *complete(req) {
        const lastUser = req.messages.find((m) => m.role === "user");
        const userText =
          lastUser?.content.find((c): c is Extract<typeof c, { type: "text" }> => c.type === "text")
            ?.text ?? "";
        yield { type: "text_delta", text: `audit(${userText})` };
        yield { type: "message_delta", stopReason: "stop" };
      },
    };

    const ws = new Workspace(process.cwd());
    const tool = subagentParallelTool(ws, mockProvider, "mock-model");
    const result = await tool.execute({
      tasks: [
        { role: "explore", prompt: "fileA.ts" },
        { role: "explore", prompt: "fileB.ts" },
      ],
    });

    assert.match(result, /Task #1 \(EXPLORE\) Result/);
    assert.match(result, /audit\(fileA\.ts\)/);
    assert.match(result, /Task #2 \(EXPLORE\) Result/);
    assert.match(result, /audit\(fileB\.ts\)/);
  });

  it("executes subagent_optimize tool and reports verdict", async () => {
    const mockProvider: LLMProvider = {
      name: "mock-llm",
      config: { type: "openai" },
      async *complete(req) {
        const sys = typeof req.system === "string" ? req.system : req.system.map((s) => s.text).join(" ");
        if (sys.includes("ROLE: REVIEWER")) {
          yield { type: "text_delta", text: "VERDICT: PASS" };
        } else {
          yield { type: "text_delta", text: "implemented solution" };
        }
        yield { type: "message_delta", stopReason: "stop" };
      },
    };

    const ws = new Workspace(process.cwd());
    const tool = subagentOptimizeTool(ws, mockProvider, "mock-model");
    const result = await tool.execute({
      task_prompt: "Write sort function",
    });

    assert.match(result, /Evaluator-Optimizer VERIFIED \(PASSED\)/);
    assert.match(result, /implemented solution/);
  });

  it("executes subagent_workflow tool with dependencies", async () => {
    const mockProvider: LLMProvider = {
      name: "mock-llm",
      config: { type: "openai" },
      async *complete(req) {
        const lastUser = req.messages.find((m) => m.role === "user");
        const userText =
          lastUser?.content.find((c): c is Extract<typeof c, { type: "text" }> => c.type === "text")
            ?.text ?? "";
        yield { type: "text_delta", text: `res(${userText})` };
        yield { type: "message_delta", stopReason: "stop" };
      },
    };

    const ws = new Workspace(process.cwd());
    const tool = subagentWorkflowTool(ws, mockProvider, "mock-model");
    const result = await tool.execute({
      tasks: [
        { id: "step1", role: "explore", prompt: "read specs" },
        { id: "step2", role: "coder", prompt: "build according to $inputs.step1", depends_on: ["step1"] },
      ],
    });

    assert.match(result, /Task \[step1\] Output/);
    assert.match(result, /res\(read specs\)/);
    assert.match(result, /Task \[step2\] Output/);
    assert.match(result, /res\(build according to res\(read specs\)\)/);
  });
});
