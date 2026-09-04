import { describe, it } from "node:test";
import assert from "node:assert";
import {
  classifyBashCommand,
  classifyToolRisk,
  isPathSensitive,
  redactSecrets,
  createDeferredPermissions,
  isWorkspaceTrusted,
  setWorkspaceTrusted,
} from "./permissions.js";

describe("Granular Permissions & Safety Risk Tiers", () => {
  it("detects sensitive credential paths as Tier 4", () => {
    assert.strictEqual(isPathSensitive(".env"), true);
    assert.strictEqual(isPathSensitive(".env.local"), true);
    assert.strictEqual(isPathSensitive("server.key"), true);
    assert.strictEqual(isPathSensitive("id_rsa"), true);
    assert.strictEqual(isPathSensitive("id_rsa.pub"), true);
    assert.strictEqual(isPathSensitive(".aws/credentials"), true);
    assert.strictEqual(isPathSensitive(".ssh/config"), true);
    assert.strictEqual(isPathSensitive(".npmrc"), true);
    assert.strictEqual(isPathSensitive(".netrc"), true);
    assert.strictEqual(isPathSensitive(".git-credentials"), true);
    assert.strictEqual(isPathSensitive("credentials.json"), true);
    assert.strictEqual(isPathSensitive("src/index.ts"), false);

    assert.strictEqual(classifyToolRisk("read_file", { path: ".env" }), 4);
    assert.strictEqual(classifyToolRisk("write_file", { path: "certs/server.key" }), 4);
    assert.strictEqual(classifyToolRisk("glob", { pattern: "**/.env" }), 4);
  });

  it("redacts credentials and private keys from records", () => {
    const raw = "sk-ant-api03-abcdef1234567890abcdef1234567890-test AKIAIOSFODNN7EXAMPLE ghp_1234567890abcdefghijklmnopqrstuvwxyz";
    const redacted = redactSecrets(raw);
    assert(!redacted.includes("AKIAIOSFODNN7EXAMPLE"));
    assert(!redacted.includes("ghp_1234567890abcdefghijklmnopqrstuvwxyz"));
    assert(redacted.includes("[REDACTED_AWS_KEY]"));
    assert(redacted.includes("[REDACTED_GITHUB_TOKEN]"));
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
    // Safe simple reads
    const lsResult = classifyBashCommand("ls -la");
    assert.strictEqual(lsResult.tier, 2);
    assert.strictEqual(lsResult.isSafe, true);

    const gitLogResult = classifyBashCommand("git log -n 5");
    assert.strictEqual(gitLogResult.tier, 2);
    assert.strictEqual(gitLogResult.isSafe, true);

    const gitStatus = classifyBashCommand("git status");
    assert.strictEqual(gitStatus.tier, 2);
    assert.strictEqual(gitStatus.isSafe, true);

    const nodeVersion = classifyBashCommand("node -v");
    assert.strictEqual(nodeVersion.tier, 2);
    assert.strictEqual(nodeVersion.isSafe, true);

    // Chained / compound commands escalate to Tier 3 or 4
    const chained = classifyBashCommand("ls; rm -rf x");
    assert.strictEqual(chained.tier, 4);
    assert.strictEqual(chained.isSafe, false);

    const backticks = classifyBashCommand("git log `id`");
    assert.strictEqual(backticks.tier, 3);
    assert.strictEqual(backticks.isSafe, false);

    const subshell = classifyBashCommand("echo $(cat .env)");
    assert.strictEqual(subshell.tier, 3);
    assert.strictEqual(subshell.isSafe, false);

    // Dangerous git flags escalate to Tier 3/4
    const gitPager = classifyBashCommand("git -c core.pager='sh -c pwn' log");
    assert.strictEqual(gitPager.tier, 3);
    assert.strictEqual(gitPager.isSafe, false);

    const gitPush = classifyBashCommand("git push origin main");
    assert.strictEqual(gitPush.tier, 4);
    assert.strictEqual(gitPush.isSafe, false);

    const gitClean = classifyBashCommand("git clean -fd");
    assert.strictEqual(gitClean.tier, 4);
    assert.strictEqual(gitClean.isSafe, false);

    // Commands reading sensitive files directly in args escalate to Tier 4
    const catEnv = classifyBashCommand("cat .env");
    assert.strictEqual(catEnv.tier, 4);
    assert.strictEqual(catEnv.isSafe, false);
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

  it("persists and reads workspace trust correctly", () => {
    const testWs = "C:/test/workspace/path";
    setWorkspaceTrusted(testWs, true);
    assert.strictEqual(isWorkspaceTrusted(testWs), true);
  });
});
