import assert from "node:assert";
import { Workspace } from "../dist/tools/fs.js";
import { gitStatusTool, gitDiffTool, gitLogTool } from "../dist/tools/git.js";

async function testGitTools() {
  const ws = new Workspace(process.cwd());

  const statusTool = gitStatusTool(ws);
  const statusRes = await statusTool.execute();
  assert(typeof statusRes === "string", "Status result must be a string");
  console.log("git_status output:", statusRes);

  const logTool = gitLogTool(ws);
  const logRes = await logTool.execute({ maxCount: 3 });
  assert(typeof logRes === "string" && logRes.length > 0, "Log result must return commits");
  console.log("git_log output:", logRes);

  const diffTool = gitDiffTool(ws);
  const diffRes = await diffTool.execute({});
  assert(typeof diffRes === "string", "Diff result must be a string");

  console.log("PASS: native git tools verified");
}

testGitTools().catch((e) => {
  console.error("FAIL:", e);
  process.exit(1);
});
