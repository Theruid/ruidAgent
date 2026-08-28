import { describe, it } from "node:test";
import assert from "node:assert";
import { searchFiles, listWorkspaceFiles } from "./fileSearch.js";

describe("File Search & Fuzzy Matching", () => {
  it("filters and ranks files matching query", () => {
    const files = ["src/config.ts", "src/sessions.ts", "src/tools/fs.ts", "README.md"];
    const matched = searchFiles(files, "config");
    assert.deepStrictEqual(matched, ["src/config.ts"]);
  });

  it("handles empty query by returning first slice", () => {
    const files = ["a.txt", "b.txt", "c.txt"];
    const matched = searchFiles(files, "", 2);
    assert.deepStrictEqual(matched, ["a.txt", "b.txt"]);
  });
});
