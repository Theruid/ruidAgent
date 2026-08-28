import { describe, it } from "node:test";
import assert from "node:assert";
import {
  classifyBashCommand,
  classifyToolRisk,
  isPathSensitive,
  createDeferredPermissions,
} from "./permissions.js";

describe("Granular Permissions & Safety Risk Tiers", () => {
  it("detects sensitive credential paths as Tier 4", () => {
    assert.strictEqual(isPathSensitive(".env"), true);
    assert.strictEqual(isPathSensitive(".env.local"), true);
    assert.strictEqual(isPathSensitive("server.key"), true);
    assert.strictEqual(isPathSensitive("id_rsa"), true);
    assert.strictEqual(isPathSensitive("credentials.json"), true);
    assert.strictEqual(isPathSensitive("src/index.ts"), false);

    assert.strictEqual(classifyToolRisk("read_file", { path: ".env" }), 4);
    assert.strictEqual(classifyToolRisk("write_file", { path: "certs/server.key" }), 4);
  });

  it("classifies read-only tools as Tier 0", () => {
    assert.strictEqual(classifyToolRisk("read_file", { path: "src/main.ts" }), 0);
    assert.strictEqual(classifyToolRisk("list_dir", { path: "." }), 0);
    assert.strictEqual(classifyToolRisk("glob", { pattern: "**/*.ts" }), 0);
    assert.strictEqual(classifyToolRisk("grep", { pattern: "fn" }), 0);
    assert.strictEqual(classifyToolRisk("git_status", {}), 0);
    assert.strictEqual(classifyToolRisk("task_create", { subject: "Plan" }), 0);
  });

  it("classifies workspace file mutations as Tier 1", () => {
    assert.strictEqual(classifyToolRisk("write_file", { path: "src/main.ts" }), 1);
    assert.strictEqual(classifyToolRisk("edit_file", { path: "src/main.ts" }), 1);
  });

  it("classifies safe bash commands as Tier 2 and mutating/chaining as Tier 3/4", () => {
    const lsResult = classifyBashCommand("ls -la");
    assert.strictEqual(lsResult.tier, 2);
    assert.strictEqual(lsResult.isSafe, true);

    const gitLogResult = classifyBashCommand("git log -n 5");
    assert.strictEqual(gitLogResult.tier, 2);
    assert.strictEqual(gitLogResult.isSafe, true);

    const npmInstall = classifyBashCommand("npm install lodash");
    assert.strictEqual(npmInstall.tier, 3);
    assert.strictEqual(npmInstall.isSafe, false);

    const subshellEvasion = classifyBashCommand("echo $(cat .env)");
    assert.strictEqual(subshellEvasion.tier, 3);
    assert.strictEqual(subshellEvasion.isSafe, false);

    const dangerousRm = classifyBashCommand("rm -rf /tmp/data");
    assert.strictEqual(dangerousRm.tier, 4);
    assert.strictEqual(dangerousRm.isSafe, false);
  });

  it("enforces plan mode restrictions (allows Tier 0/2, denies mutating)", async () => {
    const perm = createDeferredPermissions(new Set(), "plan");

    // Tier 0 is auto-approved
    const readOk = await perm.manager.check("read_file", { path: "src/index.ts" });
    assert.strictEqual(readOk, true);

    // Tier 1 mutating is blocked in plan mode
    const writeOk = await perm.manager.check("write_file", { path: "src/index.ts" });
    assert.strictEqual(writeOk, false);

    // Mutating bash is blocked in plan mode
    const bashMutateOk = await perm.manager.check("bash", { command: "npm test" });
    assert.strictEqual(bashMutateOk, false);
  });

  it("auto mode auto-approves safe/mutating operations but isolates Tier 4", async () => {
    const perm = createDeferredPermissions(new Set(), "auto");

    const writeOk = await perm.manager.check("write_file", { path: "src/index.ts" });
    assert.strictEqual(writeOk, true);

    // Tier 4 will park for confirmation
    let resolved = false;
    const tier4Promise = perm.manager.check("read_file", { path: ".env" }).then((res) => {
      resolved = res;
      return res;
    });

    assert.strictEqual(perm.isPending(), true);
    perm.respond("y");
    await tier4Promise;
    assert.strictEqual(resolved, true);
  });

  it("enforces strict Tier 4 boundary in auto mode for dangerous rm -rf commands", async () => {
    const perm = createDeferredPermissions(new Set(), "auto");

    let resolved = false;
    const dangerousCmdPromise = perm.manager.check("bash", { command: "rm -rf /" }).then((res) => {
      resolved = res;
      return res;
    });

    assert.strictEqual(perm.isPending(), true);
    perm.respond("n");
    await dangerousCmdPromise;
    assert.strictEqual(resolved, false);
  });
});
