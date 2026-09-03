import { describe, it } from "node:test";
import assert from "node:assert";
import { computeUnifiedDiff, getToolDiff } from "./diff.js";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("Unified Diff & Tool Diff Utilities (diff.ts)", () => {
  it("computes unified diff with additions, deletions, and context lines", () => {
    const oldText = "line 1\nline 2\nline 3\nline 4";
    const newText = "line 1\nline 2 modified\nline 3\nline 4\nline 5";

    const diff = computeUnifiedDiff("test.txt", oldText, newText);
    assert.strictEqual(diff[0].type, "header");
    assert.strictEqual(diff[1].type, "header");

    const delLine = diff.find((d) => d.type === "del");
    const addLine = diff.find((d) => d.type === "add" && d.text.includes("modified"));
    assert.ok(delLine?.text.includes("line 2"));
    assert.ok(addLine?.text.includes("line 2 modified"));
  });

  it("truncates long diffs and includes hunk summary", () => {
    const oldText = Array.from({ length: 30 }, (_, i) => `old line ${i}`).join("\n");
    const newText = Array.from({ length: 30 }, (_, i) => `new line ${i}`).join("\n");

    const diff = computeUnifiedDiff("big.txt", oldText, newText, 8);
    assert.strictEqual(diff.length, 9); // 8 maxLines + 1 hunk line
    const hunk = diff[diff.length - 1];
    assert.strictEqual(hunk.type, "hunk");
    assert.ok(hunk.text.includes("more lines"));
  });

  it("generates tool diff for edit_file against existing file", () => {
    const tmp = mkdtempSync(join(tmpdir(), "diff-test-"));
    const filePath = join(tmp, "sample.ts");
    writeFileSync(filePath, "const a = 1;\nconst b = 2;\n", "utf8");

    try {
      const diff = getToolDiff(
        "edit_file",
        { path: "sample.ts", old_string: "const b = 2;", new_string: "const b = 42;" },
        tmp
      );

      assert.ok(diff);
      assert.ok(diff.some((d) => d.type === "del" && d.text.includes("const b = 2;")));
      assert.ok(diff.some((d) => d.type === "add" && d.text.includes("const b = 42;")));
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("generates tool diff for write_file creating a new file", () => {
    const tmp = mkdtempSync(join(tmpdir(), "diff-write-test-"));
    try {
      const diff = getToolDiff(
        "write_file",
        { path: "newfile.txt", content: "hello world\nline 2" },
        tmp
      );

      assert.ok(diff);
      assert.strictEqual(diff[0].type, "header");
      assert.ok(diff[0].text.includes("new file"));
      assert.ok(diff.some((d) => d.type === "add" && d.text.includes("hello world")));
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("returns null for non-diffable tools or invalid inputs", () => {
    assert.strictEqual(getToolDiff("bash", { command: "ls" }), null);
    assert.strictEqual(getToolDiff("read_file", { path: "foo.txt" }), null);
    assert.strictEqual(getToolDiff("edit_file", null), null);
  });
});
