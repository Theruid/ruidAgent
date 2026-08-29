import { describe, it, beforeEach, afterEach } from "node:test";
import * as assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { MemoryManager } from "../memory/manager.js";
import {
  memoryStoreTool,
  memoryRecallTool,
  memoryListTool,
  memoryForgetTool,
} from "./memory.js";

describe("Memory Tools", () => {
  let tmpWs: string;
  let tmpGlobal: string;
  let manager: MemoryManager;

  beforeEach(() => {
    tmpWs = fs.mkdtempSync(path.join(os.tmpdir(), "ruid-mem-tool-ws-"));
    tmpGlobal = fs.mkdtempSync(path.join(os.tmpdir(), "ruid-mem-tool-gl-"));
    manager = new MemoryManager({
      workspaceRoot: tmpWs,
      globalDir: tmpGlobal,
    });
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpWs, { recursive: true, force: true });
      fs.rmSync(tmpGlobal, { recursive: true, force: true });
    } catch {}
  });

  it("stores, recalls, lists and forgets memories via tool interfaces", async () => {
    const store = memoryStoreTool(manager);
    const recall = memoryRecallTool(manager);
    const list = memoryListTool(manager);
    const forget = memoryForgetTool(manager);

    const storeRes = await store.execute({
      id: "auth-strategy",
      category: "project",
      title: "JWT Authentication Architecture",
      content: "All API routes authenticate via bearer JWT in header.",
      tags: ["jwt", "auth"],
    });
    assert.ok(storeRes.includes("Saved to workspace memory"));

    const listRes = await list.execute({});
    assert.ok(listRes.includes("auth-strategy"));

    const recallRes = await recall.execute({ query: "JWT" });
    assert.ok(recallRes.includes("JWT Authentication Architecture"));

    const forgetRes = await forget.execute({ id: "auth-strategy" });
    assert.ok(forgetRes.includes("Removed memory record"));

    const listAfter = await list.execute({});
    assert.strictEqual(listAfter, "No memory records found.");
  });
});
