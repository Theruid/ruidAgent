import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { createWorktree, sweepOrphanedWorktrees } from "./worktree.js";

describe("Git Worktree Isolation", () => {
  let tmpRepo: string;

  before(() => {
    tmpRepo = mkdtempSync(join(tmpdir(), "ruid-worktree-repo-"));
    spawnSync("git", ["init"], { cwd: tmpRepo });
    spawnSync("git", ["config", "user.name", "TestUser"], { cwd: tmpRepo });
    spawnSync("git", ["config", "user.email", "test@example.com"], { cwd: tmpRepo });

    writeFileSync(join(tmpRepo, "file.txt"), "hello worktree\n", "utf8");
    spawnSync("git", ["add", "file.txt"], { cwd: tmpRepo });
    spawnSync("git", ["commit", "-m", "init"], { cwd: tmpRepo });
  });

  after(() => {
    try {
      if (existsSync(tmpRepo)) {
        rmSync(tmpRepo, { recursive: true, force: true });
      }
    } catch {}
  });

  it("creates, diffs, and cleans up an isolated worktree branch", async () => {
    const wt = await createWorktree(tmpRepo);
    assert(existsSync(wt.path));
    assert(wt.branch.startsWith("subagent-worktree-"));

    writeFileSync(join(wt.path, "file.txt"), "mutated in worktree\n", "utf8");
    const diff = await wt.diff();
    assert(diff.includes("mutated in worktree"));

    await wt.cleanup();
    assert.strictEqual(existsSync(wt.path), false);
  });

  it("sweeps orphaned worktrees safely without throwing", async () => {
    const res = await sweepOrphanedWorktrees(tmpRepo);
    assert.strictEqual(typeof res.cleanedCount, "number");
  });
});
