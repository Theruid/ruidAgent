import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { listModels as listOpenAIModels } from "./providers/openai.js";
import { listModels as listAnthropicModels } from "./providers/anthropic.js";
import { DEFAULT_CONFIG, type AppConfig } from "./config.js";
import type { ProviderConfig } from "./providers/types.js";

export const CONFIG_PATH = join(homedir(), ".ruid", "config.json");

export function loadConfigFile(): AppConfig {
  try {
    const raw = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
    return {
      providers: raw.providers ?? {},
      default: raw.default ?? { provider: "anthropic", model: "" },
      permissions: raw.permissions,
      maxIterations: raw.maxIterations,
    };
  } catch {
    if (existsSync(CONFIG_PATH)) throw new Error(`Unreadable config at ${CONFIG_PATH}`);
    return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  }
}

export function saveConfigFile(config: AppConfig): void {
  mkdirSync(dirname(CONFIG_PATH), { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n");
}

export async function fetchModels(
  targetOrUrl: string | ProviderConfig,
  apiKey?: string,
): Promise<string[]> {
  let cfg: ProviderConfig;
  if (typeof targetOrUrl === "string") {
    cfg = { type: "openai", baseUrl: targetOrUrl, ...(apiKey ? { apiKey } : {}) };
  } else {
    cfg = targetOrUrl;
  }

  if (cfg.type === "anthropic") {
    return listAnthropicModels(cfg);
  }

  const models = await listOpenAIModels(cfg);
  if (models.length === 0) throw new Error("Endpoint returned no models.");
  return models;
}

export function addProvider(
  config: AppConfig,
  opts: {
    name: string;
    baseUrl: string;
    apiKey?: string;
    apiKeyEnv?: string;
    defaultModel?: string;
    models?: string[];
  },
): void {
  let baseUrl = opts.baseUrl;
  if (!/^https?:\/\//.test(baseUrl)) baseUrl = `https://${baseUrl}`;
  const cfg: ProviderConfig = { type: "openai", baseUrl };
  if (opts.apiKey) cfg.apiKey = opts.apiKey;
  else if (opts.apiKeyEnv) cfg.apiKeyEnv = opts.apiKeyEnv.toUpperCase();
  if (opts.defaultModel) cfg.defaultModel = opts.defaultModel;
  if (opts.models && opts.models.length > 0) cfg.models = opts.models;
  config.providers[opts.name] = cfg;
}

export function setProviderKey(
  config: AppConfig,
  name: string,
  mode: "inline" | "env",
  value: string,
): void {
  const existing = config.providers[name];
  if (!existing) throw new Error(`Unknown provider "${name}"`);
  config.providers[name] =
    mode === "inline"
      ? { ...existing, apiKey: value, apiKeyEnv: undefined }
      : { ...existing, apiKey: undefined, apiKeyEnv: value.toUpperCase() };
}

export function setDefault(config: AppConfig, name: string, modelId: string): void {
  config.default = { provider: name, model: modelId };
}

export function removeProvider(config: AppConfig, name: string): void {
  delete config.providers[name];
  if (config.default.provider === name) {
    const fallback = Object.keys(config.providers)[0] ?? "";
    config.default = { provider: fallback, model: fallback ? config.default.model : "" };
  }
}
