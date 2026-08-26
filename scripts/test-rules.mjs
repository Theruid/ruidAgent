import assert from "node:assert";
import { loadProjectInstructions, buildSystemPrompt } from "../dist/agent/systemPrompt.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

async function testProjectInstructions() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ruid-rules-test-"));
  try {
    // With no rule files
    const emptyPrompt = buildSystemPrompt(tmpDir, "linux");
    assert(!emptyPrompt.includes("--- Project Instructions"), "Should not include instructions if none present");

    // Add AGENT.md
    fs.writeFileSync(path.join(tmpDir, "AGENT.md"), "Always use TypeScript strictly.", "utf8");
    const loaded = loadProjectInstructions(tmpDir);
    assert(loaded && loaded.includes("Always use TypeScript strictly."), "Should load AGENT.md instructions");

    const promptWithRules = buildSystemPrompt(tmpDir, "linux");
    assert(promptWithRules.includes("Always use TypeScript strictly."), "System prompt should contain AGENT.md rules");
    console.log("PASS: project instruction loader verified");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

testProjectInstructions().catch((e) => {
  console.error("FAIL:", e);
  process.exit(1);
});
