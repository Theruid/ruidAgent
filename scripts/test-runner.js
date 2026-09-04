import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

function findTestFiles(dir, files = []) {
  const entries = readdirSync(dir);
  for (const entry of entries) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry !== "node_modules" && entry !== "dist" && entry !== ".git") {
        findTestFiles(full, files);
      }
    } else if (entry.endsWith(".test.ts") || entry.endsWith(".test.js")) {
      files.push(full);
    }
  }
  return files;
}

const testFiles = findTestFiles("src");
if (testFiles.length === 0) {
  console.error("No test files found in src/");
  process.exit(1);
}

const tsxCli = join("node_modules", "tsx", "dist", "cli.mjs");
const res = spawnSync(process.execPath, [tsxCli, "--test", ...testFiles], {
  stdio: "inherit",
  env: process.env,
});

process.exit(res.status ?? 0);

