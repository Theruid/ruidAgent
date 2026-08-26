import assert from "node:assert";
import { resolveProviderModel, DEFAULT_CONFIG } from "../dist/config.js";

console.log("Testing resolveProviderModel...");

// 1. Explicit override takes highest priority
const explicit = resolveProviderModel("deepseek", { type: "openai", defaultModel: "deepseek-chat" }, undefined, "custom-model");
assert.strictEqual(explicit, "custom-model");

// 2. Provider defaultModel takes priority over app-level default
const provDefault = resolveProviderModel("deepseek", { type: "openai", defaultModel: "deepseek-reasoner" }, {
  default: { provider: "deepseek", model: "fallback-model" }
});
assert.strictEqual(provDefault, "deepseek-reasoner");

// 3. App default model matches provider when provider has no defaultModel
const appDefault = resolveProviderModel("custom", { type: "openai" }, {
  default: { provider: "custom", model: "my-default-model" }
});
assert.strictEqual(appDefault, "my-default-model");

// 4. First item in provider models array
const firstInList = resolveProviderModel("custom", { type: "openai", models: ["model-alpha", "model-beta"] }, {
  default: { provider: "other", model: "other-model" }
});
assert.strictEqual(firstInList, "model-alpha");

// 5. DEFAULT_CONFIG preset default
const presetDefault = resolveProviderModel("deepseek", { type: "openai" });
assert.strictEqual(presetDefault, DEFAULT_CONFIG.providers.deepseek.defaultModel);

// 6. Anthropic fallback
const anthropicDefault = resolveProviderModel("unknown-anthropic", { type: "anthropic" });
assert.strictEqual(anthropicDefault, "claude-sonnet-5");

console.log("✓ All resolveProviderModel tests passed!");
