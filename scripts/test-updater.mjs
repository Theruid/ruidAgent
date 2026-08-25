import assert from "node:assert";
import { isNewerVersion, getLocalPackageInfo } from "../dist/updater.js";

async function testUpdater() {
  // 1. Semver comparisons
  assert.strictEqual(isNewerVersion("0.1.0", "0.2.0"), true, "0.2.0 is newer than 0.1.0");
  assert.strictEqual(isNewerVersion("0.1.0", "1.0.0"), true, "1.0.0 is newer than 0.1.0");
  assert.strictEqual(isNewerVersion("0.1.0", "0.1.1"), true, "0.1.1 is newer than 0.1.0");
  assert.strictEqual(isNewerVersion("1.0.0", "1.0.0"), false, "Equal versions should not trigger update");
  assert.strictEqual(isNewerVersion("1.2.0", "1.1.9"), false, "Older versions should not trigger update");

  // 2. Package info
  const info = getLocalPackageInfo();
  assert.strictEqual(info.name, "@theruid/ruid", "Package name should match @theruid/ruid");

  console.log("PASS: auto-updater version comparison verified");
}

testUpdater().catch((e) => {
  console.error("FAIL:", e);
  process.exit(1);
});
