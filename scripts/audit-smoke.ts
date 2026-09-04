import { classifyBashCommand, isPathSensitive, redactSecrets } from "../src/permissions.js";
import { performMatchLadder, Workspace } from "../src/tools/fs.js";

async function runAudit() {
  console.log("=== RUID PRE-RELEASE SMOKE AUDIT ===");
  let passed = 0;
  let failed = 0;

  function assert(name: string, condition: boolean) {
    if (condition) {
      console.log(`  ✓ ${name}`);
      passed++;
    } else {
      console.error(`  ✖ FAIL: ${name}`);
      failed++;
    }
  }

  // 1. Shell Injection & Chaining Tests
  assert("Block chained semicolon injection", classifyBashCommand("ls; echo pwned").tier >= 3);
  assert("Block backtick subshell", classifyBashCommand("git log `id`").tier >= 3);
  assert("Block git core.pager exploit", classifyBashCommand("git -c core.pager='sh -c pwn' log").tier >= 3);
  assert("Block dangerous git push", classifyBashCommand("git push origin main --force").tier === 4);
  assert("Block dangerous rm -rf", classifyBashCommand("rm -rf /var/log").tier === 4);

  // 2. Sensitive Path Tests
  assert("Detect .env as sensitive", isPathSensitive(".env"));
  assert("Detect nested aws credentials as sensitive", isPathSensitive(".aws/credentials"));
  assert("Detect id_rsa as sensitive", isPathSensitive("id_rsa.pub"));

  // 3. Secret Redaction Tests
  const secretSample = "My AWS key is AKIA1234567890ABCDEF and Anthropic key is sk-ant-api03-1234567890abcdef1234567890-test";
  const redacted = redactSecrets(secretSample);
  assert("Redacts AWS credentials", !redacted.includes("AKIA1234567890ABCDEF") && redacted.includes("[REDACTED_AWS_KEY]"));
  assert("Redacts Anthropic keys", !redacted.includes("sk-ant-api03-") && redacted.includes("[REDACTED_ANTHROPIC_KEY]"));

  // 4. CRLF Normalization Tests
  const crlfSample = "function test() {\r\n  console.log('hi');\r\n}\r\n";
  const editRes = performMatchLadder(crlfSample, "console.log('hi');", "console.log('hello');", false);
  assert("CRLF edit matches seamlessly", editRes.updated.includes("console.log('hello');"));

  // 5. Filesystem Path Jail Tests
  const ws = new Workspace(process.cwd());
  let escaped = false;
  try {
    ws.resolve("../../etc/passwd");
  } catch {
    escaped = true;
  }
  assert("Path jail rejects parent directory traversal", escaped);

  console.log(`\nAudit Complete: ${passed} passed, ${failed} failed.`);
  if (failed > 0) process.exit(1);
}

runAudit();
