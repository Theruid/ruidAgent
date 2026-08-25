import { Workspace, globTool } from "../dist/tools/fs.js";
import assert from "node:assert";

async function testGlob() {
  const ws = new Workspace(process.cwd());
  const tool = globTool(ws);

  // Test matching specific file extensions
  const tsFiles = await tool.execute({ pattern: "src/**/*.ts" });
  assert(tsFiles.includes("src/index.ts"), "Should find src/index.ts");
  assert(tsFiles.includes("src/agent/loop.ts"), "Should find src/agent/loop.ts");
  assert(!tsFiles.includes("node_modules"), "Should skip node_modules by default");

  // Test root files
  const pkg = await tool.execute({ pattern: "*.json" });
  assert(pkg.includes("package.json"), "Should find package.json");

  // Test brace expansion
  const multiExt = await tool.execute({ pattern: "src/**/*.{ts,tsx}" });
  assert(multiExt.includes("src/ui/App.tsx"), "Should find src/ui/App.tsx");
  assert(multiExt.includes("src/index.ts"), "Should find src/index.ts");

  console.log("PASS: glob tests succeeded");
}

testGlob().catch((e) => {
  console.error("FAIL:", e);
  process.exit(1);
});
