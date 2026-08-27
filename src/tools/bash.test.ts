import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { ProcessManager, bashTool } from "./bash.js";
import { Workspace } from "./fs.js";
import { ensureConfigDir } from "../config.js";

describe("Background Process Manager & Shell Execution", () => {
  const pm = new ProcessManager();
  const ws = new Workspace(process.cwd());

  it("spawns background processes and captures logs", async () => {
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
    // Ping/sleep loop command
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
});
