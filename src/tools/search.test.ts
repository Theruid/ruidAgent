import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { Workspace } from "./fs.js";
import { grepTool, parseRipgrepLine } from "./search.js";

describe("Search Engine (Ripgrep & Fallback)", () => {
  let tmpDir: string;
  let ws: Workspace;

  before(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ruid-search-test-"));
    ws = new Workspace(tmpDir);

    await fs.writeFile(
      path.join(tmpDir, "fileA.ts"),
      `export function calculateAlpha() {\n  return 42;\n}\n`
    );
    await fs.writeFile(
      path.join(tmpDir, "fileB.js"),
      `// Helper beta\nconst beta = "test_target_token";\n`
    );
    await fs.mkdir(path.join(tmpDir, "subdir"), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, "subdir", "fileC.txt"),
      `first line\ntest_target_token in nested file\nlast line`
    );
  });

  after(async () => {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("parses ripgrep output line across Windows and POSIX path formats", () => {
    const mockWs = new Workspace("C:/workspace/my-app");
    const lineWin = "C:\\workspace\\my-app\\src\\index.ts:42:const a = 1;";
    assert.strictEqual(parseRipgrepLine(lineWin, mockWs), "src/index.ts:42: const a = 1;");

    const lineWinFwd = "C:/workspace/my-app/src/sub/file.ts:15:const url = \"http://localhost:3000\";";
    assert.strictEqual(parseRipgrepLine(lineWinFwd, mockWs), "src/sub/file.ts:15: const url = \"http://localhost:3000\";");
  });

  it("finds occurrences across workspace files", async () => {
    const tool = grepTool(ws);
    const res = await tool.execute({ pattern: "test_target_token" });

    assert.match(res, /fileB\.js:\d+:.*test_target_token/);
    assert.match(res, /subdir[/\\]fileC\.txt:\d+:.*test_target_token/);
  });

  it("respects include glob filters", async () => {
    const tool = grepTool(ws);
    const res = await tool.execute({ pattern: "test_target_token", include: "*.js" });

    assert.match(res, /fileB\.js/);
    assert.doesNotMatch(res, /fileC\.txt/);
  });

  it("supports case-insensitive matching", async () => {
    const tool = grepTool(ws);
    const res = await tool.execute({ pattern: "CALCULATEALPHA", case_insensitive: true });

    assert.match(res, /fileA\.ts:\d+:.*calculateAlpha/);
  });

  it("returns appropriate message when no matches are found", async () => {
    const tool = grepTool(ws);
    const res = await tool.execute({ pattern: "non_existent_symbol_12345" });
    assert.match(res, /No matches for \/non_existent_symbol_12345\//);
  });
});
