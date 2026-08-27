import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { existsSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import {
  ProcessManager,
  bashTool,
  matchesInteractivePrompt,
} from "./bash.js";
import { Workspace } from "./fs.js";

describe("Background Process Manager & Shell Execution", () => {
  const pm = new ProcessManager();
  const ws = new Workspace(process.cwd());
  const scriptA = "tmp_test_prompt_hang.js";
  const scriptB = "tmp_test_prompt_cont.js";

  before(() => {
    writeFileSync(scriptA, "process.stdout.write('Do you want to continue? [y/N] '); process.stdin.resume();", "utf8");
    writeFileSync(scriptB, "process.stdout.write('Password: '); setTimeout(() => { console.log('not blocked, completed'); }, 100);", "utf8");
  });

  after(() => {
    try {
      if (existsSync(scriptA)) unlinkSync(scriptA);
      if (existsSync(scriptB)) unlinkSync(scriptB);
    } catch {}
  });

  it("detects interactive CLI prompt signatures accurately", () => {
    assert.strictEqual(matchesInteractivePrompt("Do you want to continue? [y/N]").matched, true);
    assert.strictEqual(matchesInteractivePrompt("Enter password:").matched, true);
    assert.strictEqual(matchesInteractivePrompt("Package name: (my-app)").matched, true);
    assert.strictEqual(matchesInteractivePrompt("? Select a framework:").matched, true);
    assert.strictEqual(matchesInteractivePrompt("Press any key to continue").matched, true);
    assert.strictEqual(matchesInteractivePrompt("All tests passed cleanly in 420ms\n").matched, false);
  });

  it("spawns background processes with headless env and captures logs", async () => {
    const isWin = process.platform === "win32";
    const cmd = isWin ? "echo bg_test_output" : "echo bg_test_output";
    const info = pm.spawnBackground(cmd, process.cwd());

    assert.strictEqual(info.status, "running");
    assert.match(info.id, /^proc_\d+_/);

    // Wait briefly for process to emit output and finish
    await new Promise((resolve) => setTimeout(resolve, 500));

    assert.strictEqual(existsSync(info.logFilePath), true);

    const status = pm.getStatus(info.id);
    assert.strictEqual(status?.status, "completed");

    const logs = pm.getLogs(info.id);
    assert.match(logs, /bg_test_output/);
  });

  it("kills long-running background tasks cleanly", async () => {
    const isWin = process.platform === "win32";
    const cmd = isWin ? "ping 127.0.0.1 -n 10 > nul" : "sleep 10";
    const info = pm.spawnBackground(cmd, process.cwd());

    assert.strictEqual(info.status, "running");
    const killed = pm.kill(info.id);
    assert.strictEqual(killed, true);

    const status = pm.getStatus(info.id);
    assert.strictEqual(status?.status, "killed");
  });

  it("executes foreground bash commands via tool", async () => {
    const tool = bashTool(ws, pm);
    const result = await tool.execute({ command: "echo hello_from_tool" });
    assert.match(result, /hello_from_tool/);
  });

  it("detects and terminates interactive prompts in real child process", async () => {
    const tool = bashTool(ws, pm);

    const startTime = Date.now();
    const result = await tool.execute({ command: `node ${scriptA}`, timeout_ms: 10_000 });
    const duration = Date.now() - startTime;

    // Must terminate within ~2000ms via quiet-window kill, NOT the 10000ms hard timeout
    assert.strictEqual(duration < 4000, true);
    assert.match(result, /Execution blocked: Command paused waiting for interactive user input/);
    assert.match(result, /\[y\/N\]/);
  });

  it("avoids false positives when output continues after keyword", async () => {
    const tool = bashTool(ws, pm);

    const result = await tool.execute({ command: `node ${scriptB}`, timeout_ms: 5000 });
    assert.match(result, /not blocked, completed/);
    assert.doesNotMatch(result, /Execution blocked/);
  });
});
