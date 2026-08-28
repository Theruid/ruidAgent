import test from "node:test";
import assert from "node:assert/strict";
import { resolveModelCapabilities, formatCapabilityBadge } from "./capabilities.js";

test("capabilities - Anthropic Claude 3.7 / Sonnet 5 / Opus 5 support extended thinking & prompt caching", () => {
  const caps = resolveModelCapabilities("anthropic", "claude-sonnet-5");
  assert.equal(caps.supportsThinking, true);
  assert.equal(caps.supportsTools, true);
  assert.equal(caps.supportsStructuredOutput, true);
  assert.equal(caps.supportsPromptCaching, true);
  assert.equal(caps.contextWindow, 200_000);
  assert.equal(caps.maxOutputTokens, 64_000);

  const badge = formatCapabilityBadge(caps);
  assert.match(badge, /think/);
  assert.match(badge, /200k/);
});

test("capabilities - Anthropic Claude 3.5 Sonnet has standard max tokens and no thinking", () => {
  const caps = resolveModelCapabilities("anthropic", "claude-3-5-sonnet-latest");
  assert.equal(caps.supportsThinking, false);
  assert.equal(caps.supportsTools, true);
  assert.equal(caps.supportsStructuredOutput, true);
  assert.equal(caps.supportsPromptCaching, true);
  assert.equal(caps.contextWindow, 200_000);
  assert.equal(caps.maxOutputTokens, 8_192);
});

test("capabilities - OpenAI reasoning models (o1, o3-mini) support reasoning effort and omit temperature", () => {
  const caps = resolveModelCapabilities("openai", "o3-mini");
  assert.equal(caps.supportsThinking, true);
  assert.equal(caps.supportsReasoningEffort, true);
  assert.equal(caps.supportsTools, true);
  assert.equal(caps.supportsStructuredOutput, true);
  assert.equal(caps.defaultTemperature, undefined);
  assert.equal(caps.maxOutputTokens, 100_000);
});

test("capabilities - OpenAI standard GPT-4o", () => {
  const caps = resolveModelCapabilities("openai", "gpt-4o");
  assert.equal(caps.supportsThinking, false);
  assert.equal(caps.supportsReasoningEffort, false);
  assert.equal(caps.supportsTools, true);
  assert.equal(caps.supportsStructuredOutput, true);
  assert.equal(caps.contextWindow, 128_000);
});

test("capabilities - Gemini thinking models and 9router router models", () => {
  const models = [
    "ag/gemini-3.7-flash-high",
    "ag/gemini-3.7-flash-low",
    "ag/gemini-3.7-flash-medium",
    "ag/gemini-3.6-flash-high",
    "ag/claude-opus-4-6-thinking",
  ];

  for (const m of models) {
    const caps = resolveModelCapabilities("openai", m);
    assert.equal(caps.supportsThinking, true, `Expected ${m} to have supportsThinking: true`);
  }
});

test("capabilities - Custom user overrides", () => {
  const caps = resolveModelCapabilities("openai", "custom-model", {
    type: "openai",
    capabilities: {
      supportsThinking: true,
      contextWindow: 500_000,
    },
  });
  assert.equal(caps.supportsThinking, true);
  assert.equal(caps.contextWindow, 500_000);
});
