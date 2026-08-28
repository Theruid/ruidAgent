import { describe, it } from "node:test";
import assert from "node:assert";
import { isNewerVersion, getLocalPackageInfo } from "./updater.js";

describe("Updater & Semver Logic", () => {
  it("compares semver strings accurately", () => {
    assert.strictEqual(isNewerVersion("0.3.13", "0.3.14"), true);
    assert.strictEqual(isNewerVersion("0.3.13", "0.4.0"), true);
    assert.strictEqual(isNewerVersion("0.3.13", "1.0.0"), true);
    assert.strictEqual(isNewerVersion("0.3.13", "0.3.13"), false);
    assert.strictEqual(isNewerVersion("0.3.14", "0.3.13"), false);
    assert.strictEqual(isNewerVersion("1.0.0", "0.9.9"), false);
  });

  it("gets local package information", () => {
    const info = getLocalPackageInfo();
    assert.strictEqual(info.name, "@theruid/ruid");
    assert(typeof info.version === "string");
  });
});
