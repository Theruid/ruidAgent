import type { ModelCapabilities, ProviderConfig } from "./types.js";

/**
 * Resolves the operational capabilities of an LLM based on provider type,
 * model identifier heuristics, and user configuration overrides.
 */
export function resolveModelCapabilities(
  providerType: "anthropic" | "openai",
  modelName: string,
  config?: ProviderConfig
): ModelCapabilities {
  // Normalize model string: strip provider routing prefixes (e.g. 'openrouter/anthropic/claude-3.7-sonnet' -> 'claude-3.7-sonnet')
  const raw = (modelName || "").toLowerCase().trim();
  const segments = raw.split("/");
  const leafModel = segments[segments.length - 1] ?? raw;
  const model = raw; // keep full path for specific router matches

  // Baseline defaults
  let caps: ModelCapabilities = {
    supportsTools: true,
    supportsStreaming: true,
    supportsThinking: false,
    supportsStructuredOutput: false,
    supportsPromptCaching: false,
    contextWindow: 128_000,
    maxOutputTokens: 4_096,
    defaultTemperature: 0,
    supportsReasoningEffort: false,
  };

  // General reasoning heuristics by naming conventions across all models and proxy/router providers
  const isExplicitThinking =
    raw.includes("thinking") ||
    raw.includes("reasoning") ||
    raw.includes("reasoner") ||
    raw.endsWith("-high") ||
    raw.endsWith("-medium") ||
    raw.endsWith("-low") ||
    raw.includes("gemini-3") ||
    raw.includes("gemini-2.0-flash-thinking") ||
    raw.includes("claude-3-7") ||
    raw.includes("claude-3.7") ||
    raw.includes("claude-sonnet-5") ||
    raw.includes("claude-opus-5") ||
    raw.includes("r1");

  if (isExplicitThinking) {
    caps.supportsThinking = true;
    caps.maxOutputTokens = 64_000;
  }

  if (providerType === "anthropic" || model.includes("anthropic/") || model.includes("claude")) {
    caps.supportsTools = true;
    caps.supportsStreaming = true;
    caps.supportsPromptCaching = true;
    caps.supportsStructuredOutput = true;
    caps.contextWindow = 200_000;
    if (!isExplicitThinking) {
      caps.maxOutputTokens = 8_192;
    }
  } else {
    // OpenAI and OpenAI-compatible / OpenRouter providers
    if (
      leafModel.startsWith("o1") ||
      leafModel.startsWith("o3-mini") ||
      leafModel.includes("o1-preview") ||
      leafModel.startsWith("o3")
    ) {
      // OpenAI Reasoning models
      caps.supportsTools = !leafModel.includes("preview");
      caps.supportsThinking = true;
      caps.supportsReasoningEffort = true;
      caps.supportsStructuredOutput = true;
      caps.supportsPromptCaching = true;
      caps.contextWindow = 200_000;
      caps.maxOutputTokens = 100_000;
      caps.defaultTemperature = undefined;
    } else if (model.includes("gemini")) {
      // Gemini 2.0 / 3.0 / 3.7 series
      caps.supportsTools = true;
      caps.supportsStructuredOutput = true;
      caps.contextWindow = 1_000_000;
      caps.maxOutputTokens = 64_000;
      if (isExplicitThinking) {
        caps.supportsThinking = true;
      }
    } else if (
      leafModel.startsWith("gpt-4o") ||
      leafModel.startsWith("gpt-4.5") ||
      leafModel.startsWith("chatgpt-4o")
    ) {
      caps.supportsTools = true;
      caps.supportsStructuredOutput = true;
      caps.supportsPromptCaching = true;
      caps.contextWindow = 128_000;
      caps.maxOutputTokens = 16_384;
    } else if (
      model.includes("deepseek-reasoner") ||
      model.includes("deepseek-r1") ||
      model.includes("r1")
    ) {
      caps.supportsThinking = true;
      caps.supportsTools = false;
      caps.supportsStructuredOutput = false;
      caps.contextWindow = 64_000;
      caps.maxOutputTokens = 8_192;
    } else if (model.includes("deepseek-chat") || model.includes("deepseek-v3")) {
      caps.supportsTools = true;
      caps.supportsStructuredOutput = true;
      caps.contextWindow = 64_000;
      caps.maxOutputTokens = 8_192;
    } else if (model.includes("llama-3") || model.includes("llama3")) {
      caps.supportsTools = true;
      caps.supportsStructuredOutput = false;
      caps.contextWindow = 128_000;
      caps.maxOutputTokens = 8_192;
    } else if (model.includes("qwen") || model.includes("mistral")) {
      caps.supportsTools = true;
      caps.contextWindow = 32_768;
      caps.maxOutputTokens = 4_096;
    }
  }

  // Merge user explicit capability overrides from config if present
  if (config?.capabilities) {
    caps = { ...caps, ...config.capabilities };
  }

  return caps;
}

/**
 * Returns a short capability badge string for display in UI model pickers.
 */
export function formatCapabilityBadge(caps: ModelCapabilities): string {
  const badges: string[] = [];
  if (caps.supportsThinking) badges.push("think");
  if (caps.supportsStructuredOutput) badges.push("json");
  if (caps.supportsTools) badges.push("tools");
  const ctxK = Math.round(caps.contextWindow / 1000);
  badges.push(`${ctxK}k`);
  return `[${badges.join(" · ")}]`;
}
