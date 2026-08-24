import { Workspace } from "../dist/tools/fs.js";
const ws = new Workspace(process.cwd());
const cases = [
  ["../../Windows", "block"],
  ["src/../../../Windows", "block"],
  ["C:/Windows/System32", "block"],
  ["src/../package.json", "resolve"],
];
let pass = true;
for (const [input, expect] of cases) {
  try {
    const r = ws.resolve(input);
    if (expect === "block") { console.log(`FAIL: ${input} was allowed -> ${r}`); pass = false; }
    else console.log(`ok resolved: ${input} -> ${r}`);
  } catch {
    if (expect === "resolve") { console.log(`FAIL: ${input} should resolve but was blocked`); pass = false; }
    else console.log(`ok blocked: ${input}`);
  }
}
console.log(pass ? "ALL PASS" : "FAILURES");
process.exit(pass ? 0 : 1);
