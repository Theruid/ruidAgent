import { describe, it, beforeEach, afterEach } from "node:test";
import * as assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { MemoryManager } from "./manager.js";

describe("MemoryManager", () => {
  let tmpWs: string;
  let tmpGlobal: string;
  let manager: MemoryManager;

  beforeEach(() => {
    tmpWs = fs.mkdtempSync(path.join(os.tmpdir(), "ruid-mem-ws-"));
    tmpGlobal = fs.mkdtempSync(path.join(os.tmpdir(), "ruid-mem-gl-"));
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

  it("stores and lists workspace and global memories", async () => {
    const mem1 = await manager.store({
      id: "code-style",
      category: "feedback",
      scope: "workspace",
      title: "Code Style Guide",
      content: "Use named exports instead of default exports.",
      tags: ["typescript", "style"],
    });

    assert.strictEqual(mem1.id, "code-style");
    assert.strictEqual(mem1.category, "feedback");

    const mem2 = await manager.store({
      id: "user-profile",
      category: "user",
      scope: "global",
      title: "User Profile",
      content: "Prefers concise, non-conversational replies.",
      tags: ["tone"],
    });

    const listAll = await manager.list();
    assert.strictEqual(listAll.length, 2);

    const wsList = await manager.list({ scope: "workspace" });
    assert.strictEqual(wsList.length, 1);
    assert.strictEqual(wsList[0].id, "code-style");

    const globList = await manager.list({ scope: "global" });
    assert.strictEqual(globList.length, 1);
    assert.strictEqual(globList[0].id, "user-profile");
  });

  it("recalls memories with keyword search", async () => {
    await manager.store({
      id: "database-config",
      category: "project",
      title: "PostgreSQL Database Configuration",
      content: "Staging database runs on port 5432 with schema v2.",
      tags: ["postgres", "db"],
    });

    await manager.store({
      id: "frontend-theme",
      category: "project",
      title: "Tailwind Dark Mode",
      content: "Use class-based dark mode selector in tailwind.config.",
      tags: ["tailwind", "css"],
    });

    const results = await manager.recall("postgres 5432");
    assert.ok(results.length > 0);
    assert.strictEqual(results[0].record.id, "database-config");
  });

  it("forgets memories and updates MEMORY.md index", async () => {
    await manager.store({
      id: "temp-note",
      category: "reference",
      title: "Temporary Reference",
      content: "Some temporary docs URL.",
    });

    let list = await manager.list();
    assert.strictEqual(list.length, 1);

    const deleted = await manager.forget("temp-note");
    assert.strictEqual(deleted, true);

    list = await manager.list();
    assert.strictEqual(list.length, 0);

    const indexPath = path.join(manager.getMemoryDir("workspace"), "MEMORY.md");
    assert.ok(fs.existsSync(indexPath));
  });

  it("generates system prompt summary and honors 200 lines limit", async () => {
    for (let i = 1; i <= 250; i++) {
      await manager.store({
        id: `rule-${i}`,
        category: "feedback",
        title: `Rule number ${i}`,
        content: `Always follow rule number ${i} strictly in all scenarios.`,
      });
    }

    const summary = await manager.getSystemPromptSummary(50);
    assert.ok(summary !== null);
    const lines = summary.split("\n");
    assert.ok(lines.length <= 51);
    assert.ok(summary.includes("truncated"));
  });
});
