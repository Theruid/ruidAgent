import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadConfigFile, saveConfigFile, addProvider, setProviderKey, setDefault, removeProvider } from "./configWizard.js";
import { DEFAULT_CONFIG } from "./config.js";

describe("Setup Wizard & Config Persistence (configWizard.ts)", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "ruid-wizard-test-"));
    process.env.RUID_CONFIG_DIR = tempDir;
  });

  afterEach(() => {
    delete process.env.RUID_CONFIG_DIR;
    try {
      if (existsSync(tempDir)) {
        rmSync(tempDir, { recursive: true, force: true });
      }
    } catch {}
  });

  it("loads default config and saves config file", () => {
    const config = loadConfigFile();
    assert.deepStrictEqual(config.default, DEFAULT_CONFIG.default);

    addProvider(config, {
      name: "local-vllm",
      baseUrl: "http://localhost:8000/v1",
      defaultModel: "mistral-7b",
    });
    setDefault(config, "local-vllm", "mistral-7b");
    saveConfigFile(config);

    const reloaded = loadConfigFile();
    assert.strictEqual(reloaded.default.provider, "local-vllm");
    assert.strictEqual(reloaded.default.model, "mistral-7b");
    assert(reloaded.providers["local-vllm"] !== undefined);

    setProviderKey(reloaded, "local-vllm", "env", "VLLM_API_KEY");
    assert.strictEqual(reloaded.providers["local-vllm"].apiKeyEnv, "VLLM_API_KEY");

    removeProvider(reloaded, "local-vllm");
    assert.strictEqual(reloaded.providers["local-vllm"], undefined);
  });
});
