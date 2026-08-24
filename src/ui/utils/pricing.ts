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
  "gpt-4o": [2.5, 10.0],
  "gpt-4o-mini": [0.15, 0.6],
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

const DEFAULT_RATES: [number, number] = [2.5, 10.0];

/**
 * Calculates estimated USD cost from token usage for a given model.
 */
export function calculateCost(model: string, inTokens: number, outTokens: number): number {
  const normalized = (model || "").toLowerCase();
  let rates = DEFAULT_RATES;

  for (const [key, val] of Object.entries(PRICING_PER_MILLION)) {
    if (normalized.includes(key)) {
      rates = val;
      break;
    }
  }

  const inCost = (inTokens / 1_000_000) * rates[0];
  const outCost = (outTokens / 1_000_000) * rates[1];
  return inCost + outCost;
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
