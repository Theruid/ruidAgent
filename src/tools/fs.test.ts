import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  Workspace,
  readFileTool,
  writeFileTool,
  editFileTool,
  listDirTool,
  globTool,
  globPatternToRegex,
} from "./fs.js";

describe("Workspace & Filesystem Tools (fs.ts)", () => {
  let tmpDir: string;
  let ws: Workspace;

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "ruid-fs-test-"));
    ws = new Workspace(tmpDir);

    writeFileSync(join(tmpDir, "sample.txt"), "Line 1\nLine 2\nLine 3\n", "utf8");
    writeFileSync(join(tmpDir, "binary.bin"), Buffer.from([0x48, 0x65, 0x00, 0x6c, 0x6f]));
  });

  after(() => {
    try {
      if (existsSync(tmpDir)) {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    } catch {}
  });

  it("resolves paths safely inside workspace root and rejects escapes", () => {
    assert.strictEqual(ws.resolve("sample.txt"), join(tmpDir, "sample.txt"));
    assert.throws(() => ws.resolve("../outside.txt"), /escapes workspace root/);
  });

  it("reads files with line numbering and limits", async () => {
    const read = readFileTool(ws);
    const content = await read.execute({ path: "sample.txt", offset: 1, limit: 2 });
    assert.strictEqual(content, "1\tLine 1\n2\tLine 2");
  });

  it("rejects binary files containing NUL byte", async () => {
    const read = readFileTool(ws);
    await assert.rejects(
      async () => read.execute({ path: "binary.bin" }),
      /Binary file/
    );
  });

  it("writes files and creates parent directories automatically", async () => {
    const write = writeFileTool(ws);
    await write.execute({ path: "sub/nested/file.txt", content: "hello nested\n" });
    assert.strictEqual(existsSync(join(tmpDir, "sub", "nested", "file.txt")), true);
  });

  it("edits files with exact match and replaces string", async () => {
    const edit = editFileTool(ws);
    const res = await edit.execute({
      path: "sample.txt",
      old_string: "Line 2",
      new_string: "Replaced Line 2",
    });
    assert(res.includes("Edited sample.txt"));

    const read = readFileTool(ws);
    const updated = await read.execute({ path: "sample.txt" });
    assert(updated.includes("Replaced Line 2"));
  });

  it("handles CRLF files with LF input seamlessly in edit_file", async () => {
    const crlfPath = "crlf_file.txt";
    writeFileSync(join(tmpDir, crlfPath), "First line\r\nSecond line\r\nThird line\r\n", "utf8");

    const edit = editFileTool(ws);
    // Submit LF-only old_string & new_string against CRLF file
    await edit.execute({
      path: crlfPath,
      old_string: "Second line",
      new_string: "Modified second line",
    });

    const read = readFileTool(ws);
    const updated = await read.execute({ path: crlfPath });
    assert(updated.includes("Modified second line"));
  });

  it("executes atomic multi-edit batching in edit_file", async () => {
    const batchPath = "batch_test.ts";
    writeFileSync(join(tmpDir, batchPath), "const a = 1;\nconst b = 2;\n", "utf8");

    const edit = editFileTool(ws);
    const res = await edit.execute({
      path: batchPath,
      edits: [
        { old_string: "const a = 1;", new_string: "const a = 100;" },
        { old_string: "const b = 2;", new_string: "const b = 200;" },
      ],
    });

    assert(res.includes("2 replacements"));
    const read = readFileTool(ws);
    const updated = await read.execute({ path: batchPath });
    assert(updated.includes("const a = 100;"));
    assert(updated.includes("const b = 200;"));
  });

  it("lists directory contents and runs glob searches", async () => {
    const list = listDirTool(ws);
    const entries = await list.execute({});
    assert(entries.includes("sample.txt"));

    const glob = globTool(ws);
    const globRes = await glob.execute({ pattern: "**/*.txt" });
    assert(globRes.includes("sample.txt"));
  });

  it("detects syntax diagnostic errors on invalid code writes", async () => {
    const write = writeFileTool(ws);
    const brokenCode = "export function broken( { return 1;";
    const res = await write.execute({ path: "broken.ts", content: brokenCode });
    assert(res.includes("Diagnostic Warning in broken.ts"));
  });

  it("transforms glob patterns to regex correctly", () => {
    const regex = globPatternToRegex("src/**/*.ts");
    assert(regex.test("src/agent/loop.ts"));
    assert(regex.test("src/tools/fs.ts"));
  });
});
