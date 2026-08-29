import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ProviderConfig } from "./providers/types.js";

export interface MCPServerConfig {
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  disabled?: boolean;
  trusted?: boolean;
}

export interface HookRule {
  tool?: string; // tool name to match (e.g. "bash", "mcp__*", or "*" for all)
  command: string; // shell command or script to execute
  timeoutMs?: number; // default 10000ms
}

export interface HookConfig {
  preToolUse?: HookRule[];
  postToolUse?: HookRule[];
}

export interface AppConfig {
  providers: Record<string, ProviderConfig>;
  default: { provider: string; model: string };
  permissions?: {
    autoApprove?: string[]; // tool names never to prompt for
    alwaysAsk?: string[];
  };
  mcpServers?: Record<string, MCPServerConfig>;
  hooks?: HookConfig;
  maxIterations?: number;
}

export function getConfigDir(): string {
  return process.env.RUID_CONFIG_DIR || join(homedir(), ".ruid");
}

export function getConfigPath(): string {
  return join(getConfigDir(), "config.json");
}

export const CONFIG_DIR = join(homedir(), ".ruid");
export const CONFIG_PATH = join(CONFIG_DIR, "config.json");

export const DEFAULT_CONFIG: AppConfig = {
  providers: {
    anthropic: {
      type: "anthropic",
      apiKeyEnv: "ANTHROPIC_API_KEY",
      defaultModel: "claude-sonnet-5",
      models: [
        "claude-sonnet-5",
        "claude-opus-5",
        "claude-haiku-4-5-20251001",
        "claude-3-5-sonnet-latest",
        "claude-3-5-haiku-latest",
        "claude-3-opus-latest",
      ],
    },
    openai: {
      type: "openai",
      baseUrl: "https://api.openai.com/v1",
      apiKeyEnv: "OPENAI_API_KEY",
      defaultModel: "gpt-4o",
      models: ["gpt-4o", "gpt-4o-mini", "o1", "o3-mini"],
    },
    deepseek: {
      type: "openai",
      baseUrl: "https://api.deepseek.com",
      apiKeyEnv: "DEEPSEEK_API_KEY",
      defaultModel: "deepseek-chat",
      models: ["deepseek-chat", "deepseek-reasoner"],
    },
    groq: {
      type: "openai",
      baseUrl: "https://api.groq.com/openai/v1",
      apiKeyEnv: "GROQ_API_KEY",
      defaultModel: "llama-3.3-70b-versatile",
      models: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"],
    },
    openrouter: {
      type: "openai",
      baseUrl: "https://openrouter.ai/api/v1",
      apiKeyEnv: "OPENROUTER_API_KEY",
      defaultModel: "anthropic/claude-3.5-sonnet",
    },
    ollama: {
      type: "openai",
      baseUrl: "http://localhost:11434/v1",
      defaultModel: "llama3.2",
    },
    lmstudio: {
      type: "openai",
      baseUrl: "http://localhost:1234/v1",
      defaultModel: "local-model",
    },
  },
  default: { provider: "anthropic", model: "claude-sonnet-5" },
};

export function loadConfig(overrides?: Partial<AppConfig>): AppConfig {
  let fileConfig: Partial<AppConfig> = {};
  const configPath = getConfigPath();
  if (existsSync(configPath)) {
    try {
      fileConfig = JSON.parse(readFileSync(configPath, "utf8"));
    } catch (e) {
      console.warn(`Warning: could not parse ${configPath}: ${e instanceof Error ? e.message : e}`);
    }
  }

  const mergedProviders: Record<string, ProviderConfig> = {};
  const allProviderKeys = new Set([
    ...Object.keys(DEFAULT_CONFIG.providers),
    ...Object.keys(fileConfig.providers ?? {}),
    ...Object.keys(overrides?.providers ?? {}),
  ]);

  for (const key of allProviderKeys) {
    const base = DEFAULT_CONFIG.providers[key] ?? {};
    const fromFile = fileConfig.providers?.[key] ?? {};
    const fromOverrides = overrides?.providers?.[key] ?? {};
    mergedProviders[key] = {
      ...base,
      ...fromFile,
      ...fromOverrides,
    } as ProviderConfig;
  }

  return {
    ...DEFAULT_CONFIG,
    ...fileConfig,
    ...overrides,
    providers: mergedProviders,
    mcpServers: { ...(fileConfig.mcpServers ?? {}), ...(overrides?.mcpServers ?? {}) },
    hooks: overrides?.hooks ?? fileConfig.hooks,
    default: overrides?.default ?? fileConfig.default ?? DEFAULT_CONFIG.default,
    permissions: { ...(fileConfig.permissions ?? {}), ...(overrides?.permissions ?? {}) },
  };
}

export function resolveProviderModel(
  providerName: string,
  cfg?: ProviderConfig,
  appConfig?: AppConfig,
  explicitModel?: string,
): string {
  if (explicitModel && explicitModel.trim()) return explicitModel.trim();
  if (cfg?.defaultModel && cfg.defaultModel.trim()) return cfg.defaultModel.trim();
  if (appConfig?.default?.provider === providerName && appConfig.default.model?.trim()) {
    return appConfig.default.model.trim();
  }
  if (cfg?.models && cfg.models.length > 0 && cfg.models[0].trim()) {
    return cfg.models[0].trim();
  }
  const defaultPreset = DEFAULT_CONFIG.providers[providerName];
  if (defaultPreset?.defaultModel) return defaultPreset.defaultModel;
  if (cfg?.type === "anthropic") return "claude-sonnet-5";
  return "";
}

export function ensureConfigDir(): string {
  const dir = getConfigDir();
  mkdirSync(dir, { recursive: true });
  return dir;
}

// A provider is usable when we can actually authenticate: an inline key, or a
// set env var, or no key at all (localhost servers). Missing env var = not
// usable — the REPL should surface /setup rather than fail on first request.
export function isProviderUsable(cfg: ProviderConfig): boolean {
  if (!cfg.apiKeyEnv && !cfg.apiKey) return true;
  if (cfg.apiKey) return true;
  return cfg.apiKeyEnv ? Boolean(process.env[cfg.apiKeyEnv]) : false;
}
