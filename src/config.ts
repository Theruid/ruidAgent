import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ProviderConfig } from "./providers/types.js";

export interface AppConfig {
  providers: Record<string, ProviderConfig>;
  default: { provider: string; model: string };
  permissions?: {
    autoApprove?: string[]; // tool names never to prompt for
    alwaysAsk?: string[];
  };
  maxIterations?: number;
}

const CONFIG_DIR = join(homedir(), ".codingagent");
const CONFIG_PATH = join(CONFIG_DIR, "config.json");

export const DEFAULT_CONFIG: AppConfig = {
  providers: {
    anthropic: { type: "anthropic", apiKeyEnv: "ANTHROPIC_API_KEY" },
    openai: { type: "openai", baseUrl: "https://api.openai.com/v1", apiKeyEnv: "OPENAI_API_KEY" },
    deepseek: { type: "openai", baseUrl: "https://api.deepseek.com", apiKeyEnv: "DEEPSEEK_API_KEY" },
    groq: { type: "openai", baseUrl: "https://api.groq.com/openai/v1", apiKeyEnv: "GROQ_API_KEY" },
    openrouter: { type: "openai", baseUrl: "https://openrouter.ai/api/v1", apiKeyEnv: "OPENROUTER_API_KEY" },
    ollama: { type: "openai", baseUrl: "http://localhost:11434/v1" },
    lmstudio: { type: "openai", baseUrl: "http://localhost:1234/v1" },
  },
  default: { provider: "anthropic", model: "claude-sonnet-5" },
};

export function loadConfig(overrides?: Partial<AppConfig>): AppConfig {
  let fileConfig: Partial<AppConfig> = {};
  if (existsSync(CONFIG_PATH)) {
    try {
      fileConfig = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
    } catch (e) {
      console.warn(`Warning: could not parse ${CONFIG_PATH}: ${e instanceof Error ? e.message : e}`);
    }
  }
  return {
    ...DEFAULT_CONFIG,
    ...fileConfig,
    ...overrides,
    providers: { ...DEFAULT_CONFIG.providers, ...fileConfig.providers },
    default: overrides?.default ?? fileConfig.default ?? DEFAULT_CONFIG.default,
    permissions: { ...(fileConfig.permissions ?? {}), ...(overrides?.permissions ?? {}) },
  };
}

export function ensureConfigDir(): string {
  mkdirSync(CONFIG_DIR, { recursive: true });
  return CONFIG_DIR;
}

// A provider is usable when we can actually authenticate: an inline key, or a
// set env var, or no key at all (localhost servers). Missing env var = not
// usable — the REPL should surface /setup rather than fail on first request.
export function isProviderUsable(cfg: ProviderConfig): boolean {
  if (!cfg.apiKeyEnv && !cfg.apiKey) return true;
  if (cfg.apiKey) return true;
  return cfg.apiKeyEnv ? Boolean(process.env[cfg.apiKeyEnv]) : false;
}
