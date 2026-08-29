import { describe, it } from "node:test";
import assert from "node:assert";
import { matchesToolFilter, runHooks, type HookEvent } from "./hooks.js";

describe("Tool Execution Hooks System", () => {
  it("matches tool filter rules correctly", () => {
    assert.strictEqual(matchesToolFilter("bash", "bash"), true);
    assert.strictEqual(matchesToolFilter("edit_file", "bash"), false);
    assert.strictEqual(matchesToolFilter("read_file", "*"), true);
    assert.strictEqual(matchesToolFilter("read_file", undefined), true);
    assert.strictEqual(matchesToolFilter("mcp__context7__query", "mcp__*"), true);
    assert.strictEqual(matchesToolFilter("bash", "mcp__*"), false);
  });

  it("permits tool execution when no hooks are configured", async () => {
    const event: HookEvent = {
      event: "preToolUse",
      tool: "bash",
      input: { command: "ls" },
      workspaceRoot: process.cwd(),
    };

    const res = await runHooks("preToolUse", undefined, event);
    assert.strictEqual(res.allow, true);
  });

  it("permits tool execution when hook exits with 0", async () => {
    const event: HookEvent = {
      event: "preToolUse",
      tool: "bash",
      input: { command: "echo hello" },
      workspaceRoot: process.cwd(),
    };

    const res = await runHooks(
      "preToolUse",
      {
        preToolUse: [
          {
            tool: "bash",
            command: 'node -e "process.exit(0)"',
          },
        ],
      },
      event
    );

    assert.strictEqual(res.allow, true);
  });

  it("blocks tool execution and extracts reason when hook exits with 2", async () => {
    const event: HookEvent = {
      event: "preToolUse",
      tool: "bash",
      input: { command: "rm -rf /" },
      workspaceRoot: process.cwd(),
    };

    const res = await runHooks(
      "preToolUse",
      {
        preToolUse: [
          {
            tool: "bash",
            command: 'node -e "console.error(\'Command denied by policy guard.\'); process.exit(2);"',
          },
        ],
      },
      event
    );

    assert.strictEqual(res.allow, false);
    assert(res.reason?.includes("Command denied by policy guard."));
  });

  it("fails closed when hook exits with error code or fails to run", async () => {
    const event: HookEvent = {
      event: "preToolUse",
      tool: "write_file",
      input: { path: "secret.txt", content: "data" },
      workspaceRoot: process.cwd(),
    };

    const res = await runHooks(
      "preToolUse",
      {
        preToolUse: [
          {
            tool: "write_file",
            command: 'node -e "process.exit(1)"',
          },
        ],
      },
      event
    );

    assert.strictEqual(res.allow, false);
  });

  it("receives JSON payload through stdin and environment variables", async () => {
    const event: HookEvent = {
      event: "preToolUse",
      tool: "edit_file",
      input: { path: "app.ts" },
      sessionId: "test-session-42",
      workspaceRoot: process.cwd(),
    };

    const hookScript = `
      const fs = require('fs');
      const input = fs.readFileSync(0, 'utf8');
      const data = JSON.parse(input);
      if (process.env.RUID_TOOL_NAME !== 'edit_file') {
        console.error('Env tool name mismatch');
        process.exit(2);
      }
      if (data.sessionId !== 'test-session-42') {
        console.error('Stdin session ID mismatch');
        process.exit(2);
      }
      process.exit(0);
    `;

    const res = await runHooks(
      "preToolUse",
      {
        preToolUse: [
          {
            tool: "edit_file",
            command: `node -e "${hookScript.replace(/\r?\n/g, " ")}"`,
          },
        ],
      },
      event
    );

    assert.strictEqual(res.allow, true);
  });
});
