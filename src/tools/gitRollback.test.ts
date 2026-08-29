import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import { Workspace } from "./fs.js";
import { GitCheckpointManager, gitRollbackTool } from "./gitRollback.js";

describe("Git Checkpoint & Rollback Engine", () => {
  let tmpDir: string;
  let ws: Workspace;
  let checkpoints: GitCheckpointManager;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "ruid-git-rollback-test-"));
    process.env.RUID_CONFIG_DIR = join(tmpDir, ".ruid");
    ws = new Workspace(tmpDir);
    checkpoints = new GitCheckpointManager();

    // Initialize git repository
    execSync("git init", { cwd: tmpDir, stdio: "ignore" });
    execSync("git config core.autocrlf false", { cwd: tmpDir, stdio: "ignore" });
    execSync('git config user.name "Ruid Tester"', { cwd: tmpDir, stdio: "ignore" });
    execSync('git config user.email "test@ruid.local"', { cwd: tmpDir, stdio: "ignore" });

    // Initial commit so HEAD exists
    writeFileSync(join(tmpDir, "README.md"), "# Initial Project\n", "utf8");
    execSync("git add README.md", { cwd: tmpDir, stdio: "ignore" });
    execSync('git commit -m "initial commit"', { cwd: tmpDir, stdio: "ignore" });
  });

  afterEach(() => {
    try {
      if (existsSync(tmpDir)) {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    } catch {}
  });

  it("removes directories and files created via bash/filesystem operations during turn", async () => {
    const rollback = gitRollbackTool(ws, checkpoints);

    await checkpoints.beginTurn(tmpDir);

    // Simulate bash creating a folder and copying files into it
    const newDir = join(tmpDir, "docs");
    mkdirSync(newDir, { recursive: true });
    writeFileSync(join(newDir, "index.html"), "<h1>Docs</h1>\n", "utf8");
    writeFileSync(join(newDir, "README.md"), "# Docs Readme\n", "utf8");

    assert.strictEqual(existsSync(join(newDir, "index.html")), true);
    assert.strictEqual(existsSync(join(newDir, "README.md")), true);

    const res = await rollback.execute({});
    assert(res.includes("Rollback completed successfully"));
    assert(res.includes("index.html") || res.includes("docs"));

    // Verify docs folder and files are completely removed
    assert.strictEqual(existsSync(join(newDir, "index.html")), false);
    assert.strictEqual(existsSync(join(newDir, "README.md")), false);
    assert.strictEqual(existsSync(newDir), false);
  });

  it("reverts modifications made to tracked files back to HEAD", async () => {
    const rollback = gitRollbackTool(ws, checkpoints);

    await checkpoints.beginTurn(tmpDir);

    // Modify tracked README.md
    writeFileSync(join(tmpDir, "README.md"), "# Heavily Modified Content\n", "utf8");
    assert.strictEqual(readFileSync(join(tmpDir, "README.md"), "utf8"), "# Heavily Modified Content\n");

    const res = await rollback.execute({});
    assert(res.includes("Restored original: README.md"));
    assert.strictEqual(readFileSync(join(tmpDir, "README.md"), "utf8"), "# Initial Project\n");
  });

  it("restores pre-existing uncommitted edits made before turn started", async () => {
    // User modified README.md before launching agent turn
    writeFileSync(join(tmpDir, "README.md"), "# User WIP Edit\n", "utf8");

    const rollback = gitRollbackTool(ws, checkpoints);

    await checkpoints.beginTurn(tmpDir);

    // Agent modifies README.md further
    writeFileSync(join(tmpDir, "README.md"), "# Agent Corrupted Content\n", "utf8");

    const res = await rollback.execute({});
    assert(res.includes("Restored original: README.md"));
    // Must restore to user's pre-turn state, not HEAD!
    assert.strictEqual(readFileSync(join(tmpDir, "README.md"), "utf8"), "# User WIP Edit\n");
  });

  it("persists git checkpoints across GitCheckpointManager instances", async () => {
    const sessionId = "git-sess-101";
    checkpoints.attachSession(sessionId);

    await checkpoints.beginTurn(tmpDir);

    const folder = join(tmpDir, "scripts");
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, "deploy.sh"), "echo deploy", "utf8");

    // Simulate restart with new manager instance
    const restoredManager = new GitCheckpointManager();
    restoredManager.attachSession(sessionId);

    const rollback = gitRollbackTool(ws, restoredManager);
    const res = await rollback.execute({});

    assert(res.includes("Rollback completed successfully"));
    assert.strictEqual(existsSync(join(folder, "deploy.sh")), false);
    assert.strictEqual(existsSync(folder), false);
  });
});
