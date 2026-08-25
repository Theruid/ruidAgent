import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { Workspace, writeFileTool, editFileTool } from "../dist/tools/fs.js";
import { SnapshotManager, rollbackTool } from "../dist/tools/snapshot.js";

async function testRollback() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "codingagent-rollback-test-"));
  const ws = new Workspace(tmpDir);
  const snapshots = new SnapshotManager();

  const write = writeFileTool(ws, snapshots);
  const edit = editFileTool(ws, snapshots);
  const rollback = rollbackTool(ws, snapshots);

  try {
    // 1. Initial file creation
    const testFile = path.join(tmpDir, "hello.txt");
    fs.writeFileSync(testFile, "Hello, World!\nOriginal Line 2\n", "utf8");

    // Turn 1: Modifying hello.txt and creating new.txt
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

    assert.strictEqual(fs.readFileSync(testFile, "utf8"), "Hello, World!\nMutated Line 2\n");
    assert.strictEqual(fs.existsSync(path.join(tmpDir, "new.txt")), true);

    // 2. Perform Rollback of Turn 1
    const rollbackRes = await rollback.execute({});
    assert(rollbackRes.includes("Restored original: hello.txt"), "Must restore hello.txt");
    assert(rollbackRes.includes("Removed newly created: new.txt"), "Must delete new.txt");

    // Verify disk state reverted
    assert.strictEqual(
      fs.readFileSync(testFile, "utf8"),
      "Hello, World!\nOriginal Line 2\n",
      "hello.txt content must be restored"
    );
    assert.strictEqual(
      fs.existsSync(path.join(tmpDir, "new.txt")),
      false,
      "new.txt must be removed"
    );

    console.log("PASS: snapshot & rollback engine verified");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

testRollback().catch((e) => {
  console.error("FAIL:", e);
  process.exit(1);
});
