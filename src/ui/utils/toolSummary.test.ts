import { describe, it } from "node:test";
import assert from "node:assert";
import { formatToolBadge } from "./toolSummary.js";

describe("Tool Badge Summary Utility (toolSummary.ts)", () => {
  it("formats file operations (read_file, write_file, edit_file)", () => {
    // read_file
    const readBadge = formatToolBadge("read_file", { path: "src/index.ts" }, "line1\nline2\nline3", false);
    assert.strictEqual(readBadge.title, "read_file");
    assert.strictEqual(readBadge.detail, "src/index.ts (3 lines)");

    // write_file
    const writeBadge = formatToolBadge("write_file", { path: "out.txt", content: "a\nb\n" }, undefined, false);
    assert.strictEqual(writeBadge.title, "write_file");
    assert.strictEqual(writeBadge.detail, "out.txt (3 lines written)");

    // edit_file
    const editBadge = formatToolBadge("edit_file", { path: "src/app.ts" }, "Edited src/app.ts (replaced 1 instance)", false);
    assert.strictEqual(editBadge.title, "edit_file");
    assert.strictEqual(editBadge.detail, "src/app.ts (replaced 1 instance)");
  });

  it("formats shell commands (bash)", () => {
    const bashBadge = formatToolBadge("bash", { command: "npm test" }, "pass 10\nfail 0", false);
    assert.strictEqual(bashBadge.title, "bash");
    assert.strictEqual(bashBadge.detail, "npm test (2 lines output)");

    const bashErr = formatToolBadge("bash", { command: "npm start" }, "exit 1", true);
    assert.strictEqual(bashErr.detail, "npm start (failed)");
  });

  it("formats search tools (glob, grep)", () => {
    const globBadge = formatToolBadge("glob", { pattern: "**/*.ts" }, "a.ts\nb.ts\nc.ts", false);
    assert.strictEqual(globBadge.detail, "**/*.ts (3 matches)");

    const grepBadge = formatToolBadge("grep", { pattern: "TODO", path: "src" }, "match 1\nmatch 2", false);
    assert.strictEqual(grepBadge.detail, '"TODO" in src (2 matches)');
  });

  it("formats web tools (web_search, web_fetch)", () => {
    const searchBadge = formatToolBadge("web_search", { query: "Node.js documentation" }, "Found 5 results:\n1. ...", false);
    assert.strictEqual(searchBadge.detail, '"Node.js documentation" (5 results)');

    const fetchBadge = formatToolBadge("web_fetch", { url: "https://nodejs.org/api/index.html" }, "x".repeat(2048), false);
    assert.strictEqual(fetchBadge.detail, "nodejs.org/api/index.html (2.0 KB)");
  });

  it("formats git operations (git_status, git_diff, git_log)", () => {
    const statusBadge = formatToolBadge("git_status", {}, "M src/index.ts", false);
    assert.strictEqual(statusBadge.detail, "status (changes)");

    const diffBadge = formatToolBadge("git_diff", { staged: true }, "diff line 1\ndiff line 2", false);
    assert.strictEqual(diffBadge.detail, "staged (2 lines)");

    const logBadge = formatToolBadge("git_log", { maxCount: 5 }, "c1\nc2\nc3", false);
    assert.strictEqual(logBadge.detail, "last 5 commits (3 commits)");
  });

  it("formats task tools (task_create, task_update, task_list)", () => {
    const createBadge = formatToolBadge("task_create", { subject: "Refactor core" }, "Created task #4", false);
    assert.strictEqual(createBadge.detail, "Refactor core (#4)");

    const updateBadge = formatToolBadge("task_update", { id: "2", status: "completed" }, "Updated", false);
    assert.strictEqual(updateBadge.detail, "#2 completed (updated)");

    const listBadge = formatToolBadge("task_list", {}, "#1 task A\n#2 task B", false);
    assert.strictEqual(listBadge.detail, "tasks (2 tasks)");
  });

  it("formats subagent orchestration tools", () => {
    const spawnBadge = formatToolBadge("subagent_spawn", { role: "coder", prompt: "implement feature X" }, "done", false);
    assert.ok(spawnBadge.detail.includes("[CODER]"));
    assert.ok(spawnBadge.detail.includes("(completed)"));

    const parallelBadge = formatToolBadge("subagent_parallel", { tasks: [{ role: "coder" }, { role: "tester" }] }, "done", false);
    assert.strictEqual(parallelBadge.detail, "2 workers (CODER, TESTER) (completed)");
  });

  it("formats generic unknown tool inputs cleanly", () => {
    const customBadge = formatToolBadge("custom_tool", { param1: "value123" });
    assert.strictEqual(customBadge.title, "custom_tool");
    assert.strictEqual(customBadge.detail, "value123");
  });
});
