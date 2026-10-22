/**
 * Model pricing matrix (USD per million tokens: [input, output])
 */
const PRICING_PER_MILLION: Record<string, [number, number]> = {
  // Anthropic
  "claude-3-5-sonnet": [3.0, 15.0],
  "claude-3-7-sonnet": [3.0, 15.0],
  "claude-sonnet-4": [3.0, 15.0],
  "claude-sonnet-5": [3.0, 15.0],
  "claude-3-5-haiku": [0.8, 4.0],
  "claude-haiku-4-5": [0.8, 4.0],
  "claude-3-opus": [15.0, 75.0],
  "claude-opus-5": [15.0, 75.0],

  // OpenAI
  "gpt-4o-mini": [0.15, 0.6],
  "gpt-4o": [2.5, 10.0],
  "o1": [15.0, 60.0],
  "o3-mini": [1.1, 4.4],

  // DeepSeek
  "deepseek-chat": [0.27, 1.1],
  "deepseek-reasoner": [0.55, 2.19],
  "deepseek-r1": [0.55, 2.19],
  "deepseek-v3": [0.27, 1.1],

  // Groq & OpenRouter open weights
  "llama-3.3-70b": [0.59, 0.79],
  "llama-3.1-8b": [0.05, 0.08],
  "mixtral-8x7b": [0.24, 0.24],
};

function ratesFor(model: string): [number, number] | null {
  const normalized = (model || "").toLowerCase();
  for (const [key, val] of Object.entries(PRICING_PER_MILLION)) {
    if (normalized.includes(key)) return val;
  }
  return null;
}

/** True when the model has an entry in the pricing table. */
export function hasKnownPricing(model: string): boolean {
  return ratesFor(model) !== null;
}

/**
 * Calculates estimated USD cost from token usage for a given model,
 * accounting for prompt caching discounts (0.1x for cache reads, 1.25x for cache creation).
 * `inTokens` is the total prompt size, cache reads and writes included.
 * Models missing from the table (local Ollama models, custom endpoints) cost 0
 * rather than a guessed rate.
 */
export function calculateCost(
  model: string,
  inTokens: number,
  outTokens: number,
  cacheReadTokens = 0,
  cacheCreationTokens = 0
): number {
  const rates = ratesFor(model);
  if (!rates) return 0;

  // Base prompt tokens excluding cache read/creation
  const baseInputTokens = Math.max(0, inTokens - cacheReadTokens - cacheCreationTokens);

  const baseInputCost = (baseInputTokens / 1_000_000) * rates[0];
  const cacheReadCost = (cacheReadTokens / 1_000_000) * (rates[0] * 0.1);
  const cacheCreationCost = (cacheCreationTokens / 1_000_000) * (rates[0] * 1.25);
  const outCost = (outTokens / 1_000_000) * rates[1];

  return baseInputCost + cacheReadCost + cacheCreationCost + outCost;
}

/**
 * Formats token counts nicely (e.g. 120, 4.2k, 1.2M)
 */
export function formatTokenCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return `${(n / 1_000_000).toFixed(2).replace(/\.00$/, "")}M`;
}

/**
 * Formats USD cost (e.g. <$0.01, ~$0.04)
 */
export function formatCost(usd: number): string {
  if (usd <= 0) return "$0.00";
  if (usd < 0.005) return "<$0.01";
  return `~$${usd.toFixed(2)}`;
}

/**
 * Formats latency duration (e.g. 420ms, 1.4s)
 */
export function formatLatency(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * Formats a wall-clock duration for live/elapsed display,
 * rolling over to minutes and hours (e.g. 820ms, 1.4s, 2m 05s, 1h 04m)
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${String(minutes % 60).padStart(2, "0")}m`;
}
