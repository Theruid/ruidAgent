import { describe, it } from "node:test";
import assert from "node:assert";
import { pipeline, parallel, runEvaluatorOptimizer, workflowDAG } from "./orchestration.js";
import type { LLMProvider } from "../providers/types.js";

describe("Orchestration (Pipeline, Parallel, Optimizer & DAG)", () => {
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

  it("runs evaluator-optimizer and passes on first iteration when verified", async () => {
    const passProvider: LLMProvider = {
      name: "pass-mock",
      config: { type: "openai" },
      async *complete(req) {
        const sys = typeof req.system === "string" ? req.system : req.system.map((s) => s.text).join(" ");
        if (sys.includes("ROLE: REVIEWER")) {
          yield { type: "text_delta", text: "All tests pass. VERDICT: PASS" };
        } else {
          yield { type: "text_delta", text: "export const add = (a: number, b: number) => a + b;" };
        }
        yield { type: "message_delta", stopReason: "stop" };
      },
    };

    const res = await runEvaluatorOptimizer(
      {
        coderPrompt: "Implement add function",
        maxIterations: 3,
      },
      {
        provider: passProvider,
        model: "mock-model",
        workspaceRoot: process.cwd(),
      }
    );

    assert.strictEqual(res.passed, true);
    assert.strictEqual(res.iterations, 1);
    assert(res.finalOutput.includes("export const add"));
  });

  it("runs evaluator-optimizer feedback loop and recovers on second iteration", async () => {
    let reviewerCalls = 0;
    const retryProvider: LLMProvider = {
      name: "retry-mock",
      config: { type: "openai" },
      async *complete(req) {
        const sys = typeof req.system === "string" ? req.system : req.system.map((s) => s.text).join(" ");
        if (sys.includes("ROLE: REVIEWER")) {
          reviewerCalls++;
          if (reviewerCalls === 1) {
            yield { type: "text_delta", text: "VERDICT: FAIL - missing negative number tests" };
          } else {
            yield { type: "text_delta", text: "VERDICT: PASS" };
          }
        } else {
          yield { type: "text_delta", text: "code_v" + reviewerCalls };
        }
        yield { type: "message_delta", stopReason: "stop" };
      },
    };

    const res = await runEvaluatorOptimizer(
      {
        coderPrompt: "Implement subtract function",
        maxIterations: 3,
      },
      {
        provider: retryProvider,
        model: "mock-model",
        workspaceRoot: process.cwd(),
      }
    );

    assert.strictEqual(res.passed, true);
    assert.strictEqual(res.iterations, 2);
  });

  it("executes DAG workflow respecting topological dependencies", async () => {
    const dagProvider: LLMProvider = {
      name: "dag-mock",
      config: { type: "openai" },
      async *complete(req) {
        const lastUser = req.messages.find((m) => m.role === "user");
        const userText =
          lastUser?.content.find((c): c is Extract<typeof c, { type: "text" }> => c.type === "text")
            ?.text ?? "";
        yield { type: "text_delta", text: `OUT(${userText})` };
        yield { type: "message_delta", stopReason: "stop" };
      },
    };

    const tasks = [
      {
        id: "plan",
        role: "explore" as const,
        promptTemplate: () => "explore codebase",
      },
      {
        id: "implement",
        role: "coder" as const,
        promptTemplate: (inputs: Record<string, string>) => `code with plan: ${inputs.plan}`,
        dependsOn: ["plan"],
      },
      {
        id: "review",
        role: "reviewer" as const,
        promptTemplate: (inputs: Record<string, string>) => `verify code: ${inputs.implement}`,
        dependsOn: ["implement"],
      },
    ];

    const result = await workflowDAG(tasks, {
      provider: dagProvider,
      model: "mock-model",
      workspaceRoot: process.cwd(),
    });

    assert.strictEqual(Object.keys(result.errors).length, 0);
    assert.strictEqual(result.outputs["plan"], "OUT(explore codebase)");
    assert.strictEqual(result.outputs["implement"], "OUT(code with plan: OUT(explore codebase))");
    assert.strictEqual(result.outputs["review"], "OUT(verify code: OUT(code with plan: OUT(explore codebase)))");
  });
});
