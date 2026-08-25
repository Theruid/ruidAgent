import assert from "node:assert";
import { listWorkspaceFiles, searchFiles } from "../dist/ui/utils/fileSearch.js";

async function testFileSearch() {
  const files = listWorkspaceFiles(process.cwd());
  assert(files.includes("src/index.ts"), "Should list src/index.ts");
  assert(files.includes("package.json"), "Should list package.json");
  assert(!files.some((f) => f.startsWith("node_modules")), "Should ignore node_modules");

  // 1. Exact / prefix match
  const search1 = searchFiles(files, "index.ts");
  assert(search1.includes("src/index.ts"), "Should match src/index.ts for query index.ts");

  // 2. Fuzzy match
  const search2 = searchFiles(files, "loop");
  assert(search2.includes("src/agent/loop.ts"), "Should match src/agent/loop.ts for query loop");

  // 3. Query with leading @
  const search3 = searchFiles(files, "@package");
  assert(search3.includes("package.json"), "Should match package.json with leading @");

  console.log("PASS: @ file search & fuzzy autocomplete verified");
}

testFileSearch().catch((e) => {
  console.error("FAIL:", e);
  process.exit(1);
});
