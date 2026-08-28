import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { Workspace } from "./fs.js";
import { gitStatusTool, gitDiffTool, gitLogTool } from "./git.js";

describe("Git Tools (Status, Diff, Log)", () => {
  let tmpRepo: string;
  let ws: Workspace;

  before(() => {
    tmpRepo = mkdtempSync(join(tmpdir(), "ruid-git-test-"));
    ws = new Workspace(tmpRepo);

    spawnSync("git", ["init"], { cwd: tmpRepo });
    spawnSync("git", ["config", "user.name", "TestUser"], { cwd: tmpRepo });
    spawnSync("git", ["config", "user.email", "test@example.com"], { cwd: tmpRepo });

    writeFileSync(join(tmpRepo, "initial.txt"), "Initial Content\n", "utf8");
    spawnSync("git", ["add", "initial.txt"], { cwd: tmpRepo });
    spawnSync("git", ["commit", "-m", "initial commit"], { cwd: tmpRepo });
  });

  after(() => {
    try {
      if (existsSync(tmpRepo)) {
        rmSync(tmpRepo, { recursive: true, force: true });
      }
    } catch {}
  });

  it("checks git status on modified files", async () => {
    const statusTool = gitStatusTool(ws);
    writeFileSync(join(tmpRepo, "new-untracked.txt"), "untracked\n", "utf8");

    const status = await statusTool.execute();
    assert(status.includes("new-untracked.txt") || status.includes("??"));
  });

  it("checks git diff on unstaged and staged edits", async () => {
    const diffTool = gitDiffTool(ws);
    writeFileSync(join(tmpRepo, "initial.txt"), "Modified Line\n", "utf8");

    const diff = await diffTool.execute({});
    assert(diff.includes("Modified Line") || diff.includes("-Initial Content"));
  });

  it("shows git log history", async () => {
    const logTool = gitLogTool(ws);
    const log = await logTool.execute({ maxCount: 5 });
    assert(log.includes("initial commit"));
  });
});
