import assert from "node:assert";
import { buildSubagentSystemPrompt } from "../dist/agent/subagent.js";
import { Workspace } from "../dist/tools/fs.js";
import { subagentTool } from "../dist/tools/subagent.js";

async function testSubagent() {
  // 1. Role prompts
  const explorePrompt = buildSubagentSystemPrompt("explore", process.cwd(), "win32");
  assert(explorePrompt.includes("[ROLE: EXPLORE]"), "Prompt must contain role header");
  assert(explorePrompt.includes("read-only research specialist"), "Prompt must contain explore guidelines");

  const reviewerPrompt = buildSubagentSystemPrompt("reviewer", process.cwd(), "win32");
  assert(reviewerPrompt.includes("[ROLE: REVIEWER]"), "Prompt must contain role header");
  assert(reviewerPrompt.includes("adversarial code reviewer"), "Prompt must contain reviewer guidelines");

  const coderPrompt = buildSubagentSystemPrompt("coder", process.cwd(), "win32");
  assert(coderPrompt.includes("[ROLE: CODER]"), "Prompt must contain role header");

  // 2. Mock provider subagent execution
  const mockProvider = {
    name: "mock",
    config: { type: "openai" },
    async *complete() {
      yield { type: "text_delta", text: "Found 3 auth files in codebase." };
      yield { type: "message_delta", stopReason: "end_turn" };
    },
  };

  const ws = new Workspace(process.cwd());
  const tool = subagentTool(ws, mockProvider, "mock-model");

  const result = await tool.execute({
    role: "explore",
    prompt: "Find all auth files",
    maxIterations: 5,
  });

  assert(result.includes("[Sub-Agent (EXPLORE) Result]:"), "Result must contain role tag");
  assert(result.includes("Found 3 auth files in codebase."), "Result must contain subagent output text");

  console.log("PASS: sub-agent swarm delegation engine verified");
}

testSubagent().catch((e) => {
  console.error("FAIL:", e);
  process.exit(1);
});
