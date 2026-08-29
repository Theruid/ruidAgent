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
    process.env.RUID_CONFIG_DIR = join(tmpDir, ".ruid");
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

  it("persists checkpoints to disk and reloads them across SnapshotManager instances", async () => {
    const edit = editFileTool(ws, snapshots);
    const sessionId = "sess-persisted-123";
    snapshots.attachSession(sessionId);

    const testFile = join(tmpDir, "persisted.txt");
    writeFileSync(testFile, "Initial content\n", "utf8");

    snapshots.beginTurn();
    await edit.execute({
      path: "persisted.txt",
      old_string: "Initial content",
      new_string: "Updated content",
    });

    assert.strictEqual(readFileSync(testFile, "utf8"), "Updated content\n");

    // Create a brand new SnapshotManager simulating app restart
    const restoredSnapshots = new SnapshotManager();
    restoredSnapshots.attachSession(sessionId);

    const rollback = rollbackTool(ws, restoredSnapshots);
    const rollbackRes = await rollback.execute({});

    assert(rollbackRes.includes("Restored original: persisted.txt"));
    assert.strictEqual(readFileSync(testFile, "utf8"), "Initial content\n");
  });

  it("captures and restores binary files using base64 encoding", async () => {
    const edit = editFileTool(ws, snapshots);
    const rollback = rollbackTool(ws, snapshots);

    const binFile = join(tmpDir, "data.bin");
    const binaryData = Buffer.from([0x00, 0xff, 0x42, 0x00, 0x7f, 0xaa]);
    writeFileSync(binFile, binaryData);

    snapshots.beginTurn();
    // Simulate mutating the binary file
    snapshots.capture(tmpDir, "data.bin");
    writeFileSync(binFile, Buffer.from([0x99, 0x88, 0x77]));

    const rollbackRes = await rollback.execute({});
    assert(rollbackRes.includes("Restored original: data.bin"));

    const restoredData = readFileSync(binFile);
    assert.deepStrictEqual(restoredData, binaryData);
  });

  it("rolls back the most recent turn with file changes, skipping empty later turns", async () => {
    const write = writeFileTool(ws, snapshots);
    const rollback = rollbackTool(ws, snapshots);

    snapshots.beginTurn(); // turn 1: creates file
    await write.execute({ path: "created.txt", content: "brand new\n" });
    snapshots.beginTurn(); // turn 2: pure chat, no file ops
    snapshots.beginTurn(); // turn 3: still no file ops

    const rollbackRes = await rollback.execute({});
    assert(rollbackRes.includes("Removed newly created: created.txt"));
    assert.strictEqual(existsSync(join(tmpDir, "created.txt")), false);
  });

  it("throws a clear error when no turn recorded file modifications", async () => {
    const rollback = rollbackTool(ws, snapshots);

    snapshots.beginTurn(); // no file ops at all

    const rollbackRes = await rollback.execute({});
    assert(rollbackRes.includes("Rollback failed"));
    assert(rollbackRes.includes("No turns with file modifications"));
  });

  it("removes created folders when files inside them are deleted during rollback", async () => {
    const write = writeFileTool(ws, snapshots);
    const rollback = rollbackTool(ws, snapshots);

    snapshots.beginTurn();
    await write.execute({
      path: "nested/deep/folder/index.html",
      content: "<h1>Hello</h1>",
    });

    assert.strictEqual(existsSync(join(tmpDir, "nested", "deep", "folder", "index.html")), true);

    const rollbackRes = await rollback.execute({});
    assert(rollbackRes.includes("Removed newly created: nested/deep/folder/index.html"));

    // Verify the created directories are also completely cleaned up
    assert.strictEqual(existsSync(join(tmpDir, "nested", "deep", "folder", "index.html")), false);
    assert.strictEqual(existsSync(join(tmpDir, "nested", "deep", "folder")), false);
    assert.strictEqual(existsSync(join(tmpDir, "nested", "deep")), false);
    assert.strictEqual(existsSync(join(tmpDir, "nested")), false);
  });
});
