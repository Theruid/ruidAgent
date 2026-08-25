import assert from "node:assert";
import { createDeferredPermissions } from "../dist/permissions.js";
import { buildSystemPrompt } from "../dist/agent/systemPrompt.js";
import { AgentUIStore } from "../dist/ui/store.js";

async function testModes() {
  const autoApprove = new Set(["read_file", "list_dir", "glob", "grep"]);

  // 1. Code Mode (default): read auto-approved, write requires check
  const codePerm = createDeferredPermissions(autoApprove, "code");
  assert.strictEqual(codePerm.getMode(), "code");
  const readAllowed = await codePerm.manager.check("read_file", {});
  assert.strictEqual(readAllowed, true, "Read should be auto-approved in code mode");

  // 2. Plan Mode: read allowed, write denied immediately without prompt
  const planPerm = createDeferredPermissions(autoApprove, "plan");
  assert.strictEqual(planPerm.getMode(), "plan");
  const planReadAllowed = await planPerm.manager.check("read_file", {});
  assert.strictEqual(planReadAllowed, true, "Read should be allowed in plan mode");
  const planWriteAllowed = await planPerm.manager.check("write_file", {});
  assert.strictEqual(planWriteAllowed, false, "Write must be disallowed in plan mode");

  // 3. Auto Mode: all tools auto-approved
  const autoPerm = createDeferredPermissions(autoApprove, "auto");
  assert.strictEqual(autoPerm.getMode(), "auto");
  const autoWriteAllowed = await autoPerm.manager.check("write_file", {});
  assert.strictEqual(autoWriteAllowed, true, "Write should be auto-approved in auto mode");
  const autoBashAllowed = await autoPerm.manager.check("bash", {});
  assert.strictEqual(autoBashAllowed, true, "Bash should be auto-approved in auto mode");

  // 4. System prompt reflects mode
  const planPrompt = buildSystemPrompt(process.cwd(), "win32", "plan");
  assert(planPrompt.includes("CURRENT MODE: PLAN MODE"), "System prompt must include plan guidelines");

  const autoPrompt = buildSystemPrompt(process.cwd(), "win32", "auto");
  assert(autoPrompt.includes("CURRENT MODE: AUTONOMOUS MODE"), "System prompt must include auto guidelines");

  // 5. Store mode cycling (code -> plan -> auto -> code)
  const store = new AgentUIStore("anthropic", "claude-sonnet-5", true);
  assert.strictEqual(store.getState().mode, "code");
  assert.strictEqual(store.cycleMode(), "plan");
  assert.strictEqual(store.cycleMode(), "auto");
  assert.strictEqual(store.cycleMode(), "code");

  console.log("PASS: mode engine and permission strategies verified");
}

testModes().catch((e) => {
  console.error("FAIL:", e);
  process.exit(1);
});
