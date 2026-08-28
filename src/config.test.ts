import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  loadConfig,
  resolveProviderModel,
  isProviderUsable,
  DEFAULT_CONFIG,
  type AppConfig,
} from "./config.js";

describe("Config Management & Provider Resolution", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "ruid-config-test-"));
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

  it("loads default configuration when no file exists", () => {
    const cfg = loadConfig();
    assert.strictEqual(cfg.default.provider, "anthropic");
    assert.strictEqual(cfg.default.model, "claude-sonnet-5");
    assert.strictEqual(cfg.providers.anthropic.defaultModel, "claude-sonnet-5");
    assert.strictEqual(cfg.providers.deepseek.baseUrl, "https://api.deepseek.com");
  });

  it("merges file config with defaults cleanly", () => {
    const customConfig = {
      default: { provider: "deepseek", model: "deepseek-reasoner" },
      providers: {
        custom: {
          type: "openai",
          baseUrl: "http://localhost:8000/v1",
          defaultModel: "my-custom-model",
        },
      },
    };
    writeFileSync(join(tempDir, "config.json"), JSON.stringify(customConfig), "utf8");

    const loaded = loadConfig();
    assert.strictEqual(loaded.default.provider, "deepseek");
    assert.strictEqual(loaded.default.model, "deepseek-reasoner");
    assert.strictEqual(loaded.providers.custom?.defaultModel, "my-custom-model");
    assert(loaded.providers.anthropic !== undefined);
  });

  it("resolves model with explicit model precedence", () => {
    const resolved = resolveProviderModel("anthropic", DEFAULT_CONFIG.providers.anthropic, DEFAULT_CONFIG, "claude-opus-5");
    assert.strictEqual(resolved, "claude-opus-5");
  });

  it("resolves model with config defaultModel fallback", () => {
    const resolved = resolveProviderModel("deepseek", DEFAULT_CONFIG.providers.deepseek, DEFAULT_CONFIG);
    assert.strictEqual(resolved, "deepseek-chat");
  });

  it("validates provider usability correctly", () => {
    assert.strictEqual(isProviderUsable({ type: "openai", apiKey: "secret" }), true);
    assert.strictEqual(isProviderUsable({ type: "openai", apiKeyEnv: "NON_EXISTENT_KEY_12345" }), false);
  });

  it("smoke tests all default provider presets", () => {
    for (const [name, p] of Object.entries(DEFAULT_CONFIG.providers)) {
      assert(p.type === "anthropic" || p.type === "openai", `Provider ${name} must have valid type`);
      if (p.baseUrl) {
        assert(/^https?:\/\//.test(p.baseUrl), `Provider ${name} baseUrl must be valid URL`);
      }
      const resolved = resolveProviderModel(name, p, DEFAULT_CONFIG);
      assert(resolved.length > 0, `Provider ${name} must resolve a non-empty model`);
    }
  });
});
