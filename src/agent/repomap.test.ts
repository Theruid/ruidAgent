import { describe, it } from "node:test";
import assert from "node:assert";
import { extractSymbolsFromContent, generateRepoMap } from "./repomap.js";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("Repository Map & Symbol Extractor", () => {
  it("extracts TypeScript exported functions, classes, and types", () => {
    const tsCode = `
export interface UserConfig {
  id: string;
}

export class AgentOrchestrator {
  run() {}
}

export function executeTask(name: string): boolean {
  return true;
}

export type Mode = "code" | "plan";
`;

    const symbols = extractSymbolsFromContent(tsCode, ".ts");
    assert.strictEqual(symbols.length, 4);
    assert.deepStrictEqual(symbols.map((s) => s.name), [
      "UserConfig",
      "AgentOrchestrator",
      "executeTask",
      "Mode",
    ]);
  });

  it("extracts Python classes and functions", () => {
    const pyCode = `
class AgentRunner:
    def execute(self):
        pass

def run_pipeline(steps):
    return True
`;

    const symbols = extractSymbolsFromContent(pyCode, ".py");
    assert.strictEqual(symbols.length, 3);
    assert.strictEqual(symbols[0].name, "AgentRunner");
    assert.strictEqual(symbols[1].name, "execute");
    assert.strictEqual(symbols[2].name, "run_pipeline");
  });

  it("generates structured XML repo_map from workspace directory", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "ruid-repomap-test-"));
    try {
      mkdirSync(join(tempDir, "src"), { recursive: true });
      writeFileSync(
        join(tempDir, "src", "index.ts"),
        `export function startAgent() {}\nexport class AgentCLI {}\n`
      );

      const map = await generateRepoMap(tempDir, 10, 500);
      assert(map !== null);
      assert(map.includes("<repo_map>"));
      assert(map.includes("src/index.ts:"));
      assert(map.includes("function startAgent"));
      assert(map.includes("class AgentCLI"));
      assert(map.includes("</repo_map>"));
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
