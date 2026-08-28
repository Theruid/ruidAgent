import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Workspace, writeFileTool, editFileTool } from "./fs.js";
import { SnapshotManager, rollbackTool } from "./snapshot.js";

describe("Snapshot & Rollback Engine", () => {
  let tmpDir: string;
  let ws: Workspace;
  let snapshots: SnapshotManager;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "ruid-rollback-test-"));
    ws = new Workspace(tmpDir);
    snapshots = new SnapshotManager();
  });

  afterEach(() => {
    try {
      if (existsSync(tmpDir)) {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    } catch {}
  });

  it("reverts file modifications and deletes created files on rollback", async () => {
    const write = writeFileTool(ws, snapshots);
    const edit = editFileTool(ws, snapshots);
    const rollback = rollbackTool(ws, snapshots);

    const testFile = join(tmpDir, "hello.txt");
    writeFileSync(testFile, "Hello, World!\nOriginal Line 2\n", "utf8");

    snapshots.beginTurn();

    await edit.execute({
      path: "hello.txt",
      old_string: "Original Line 2",
      new_string: "Mutated Line 2",
    });

    await write.execute({
      path: "new.txt",
      content: "This is a brand new file\n",
    });

    assert.strictEqual(readFileSync(testFile, "utf8"), "Hello, World!\nMutated Line 2\n");
    assert.strictEqual(existsSync(join(tmpDir, "new.txt")), true);

    const rollbackRes = await rollback.execute({});
    assert(rollbackRes.includes("Restored original: hello.txt"));
    assert(rollbackRes.includes("Removed newly created: new.txt"));

    assert.strictEqual(readFileSync(testFile, "utf8"), "Hello, World!\nOriginal Line 2\n");
    assert.strictEqual(existsSync(join(tmpDir, "new.txt")), false);
  });

  it("explicitly reports unrevertable side-effect commands executed during the turn", async () => {
    const edit = editFileTool(ws, snapshots);
    const rollback = rollbackTool(ws, snapshots);

    const testFile = join(tmpDir, "app.ts");
    writeFileSync(testFile, "const x = 1;\n", "utf8");

    snapshots.beginTurn();

    await edit.execute({
      path: "app.ts",
      old_string: "const x = 1;",
      new_string: "const x = 2;",
    });

    // Record bash side effect command in the same turn
    snapshots.recordSideEffect("bash: npm install express");

    const rollbackRes = await rollback.execute({});
    assert(rollbackRes.includes("Restored original: app.ts"));
    assert(rollbackRes.includes("Note: The following side-effecting commands were run"));
    assert(rollbackRes.includes("npm install express"));
  });
});
