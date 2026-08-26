#!/usr/bin/env node
import React from "react";
import { loadConfig, resolveProviderModel } from "./config.js";
import { createAnthropicProvider } from "./providers/anthropic.js";
import { createOpenAIProvider } from "./providers/openai.js";
import { fetchModels } from "./configWizard.js";
import type { LLMProvider, ProviderConfig } from "./providers/types.js";

interface CliArgs {
  prompt?: string;
  provider?: string;
  model?: string;
  baseUrl?: string;
  apiKey?: string;
  listModels?: boolean;
  setup?: boolean;
  help?: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-p" || a === "--prompt") {
      args.prompt = argv[++i];
    } else if (a === "--provider") {
      args.provider = argv[++i];
    } else if (a === "--model") {
      args.model = argv[++i];
    } else if (a === "--base-url") {
      args.baseUrl = argv[++i];
    } else if (a === "--api-key") {
      args.apiKey = argv[++i];
    } else if (a === "--list-models") {
      args.listModels = true;
    } else if (a === "setup") {
      args.setup = true;
    } else if (a === "-h" || a === "--help") {
      args.help = true;
    }
  }
  return args;
}

function printHelp(): void {
  console.log(`ruid (@theruid/ruid) — CLI coding agent that works with any LLM

Usage:
  ruid                 Interactive REPL
  ruid -p "<prompt>"   One-shot mode (non-interactive)
  ruid setup           Interactive provider setup (add endpoints, keys, models)

Options:
  -p, --prompt <text>     Run a single prompt and exit
      --provider <name>   Provider name from config
      --model <id>        Model ID override for this run
      --base-url <url>    Bring-your-own OpenAI-compatible endpoint
                          (e.g. https://api.deepseek.com or http://localhost:11434/v1)
      --api-key <key>     API key for the endpoint (prefer env vars over inline keys)
      --list-models       Query the endpoint's /models and print available model IDs
  -h, --help              Show this help

Providers are configured in ~/.ruid/config.json (or ~/.codingagent/config.json).`);
}

export function createProvider(name: string, cfg: ProviderConfig): LLMProvider {
  switch (cfg.type) {
    case "anthropic":
      return createAnthropicProvider(cfg);
    case "openai":
      return createOpenAIProvider(cfg);
    default:
      throw new Error(`Unknown provider type "${(cfg as any).type}" for "${name}"`);
  }
}

// Resolve which provider config to use: ad-hoc flags > named config provider.
function resolveProviderConfig(
  args: CliArgs,
  config: ReturnType<typeof loadConfig>,
): { name: string; cfg: ProviderConfig } {
  if (args.baseUrl) {
    return {
      name: `custom (${args.baseUrl})`,
      cfg: {
        type: "openai",
        baseUrl: args.baseUrl,
        ...(args.apiKey ? { apiKey: args.apiKey } : {}),
        headers: {},
      },
    };
  }

  const name = args.provider ?? config.default.provider;
  const cfg = config.providers[name];
  if (!cfg) {
    throw new Error(
      `Unknown provider "${name}". Available: ${Object.keys(config.providers).join(", ")} — or pass --base-url for a custom endpoint.`,
    );
  }

  // Allow key override on a named provider without editing config.
  if (args.apiKey) cfg.apiKey = args.apiKey;

  return { name, cfg };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  if (args.setup) {
    process.stdout.write("\x1b[?1049h");
    const { render } = await import("ink");
    const { SetupWizard } = await import("./ui/components/SetupWizard.js");
    let done: () => void = () => {};
    const finished = new Promise<void>((r) => (done = r));
    const instance = render(
      React.createElement(SetupWizard, {
        onDone: () => {
          instance.unmount();
          done();
        },
      }),
    );
    await finished;
    process.stdout.write("\x1b[?1049l");
    return;
  }

  const config = loadConfig();
  const { name, cfg } = resolveProviderConfig(args, config);
  const model = resolveProviderModel(name, cfg, config, args.model);

  if (args.listModels) {
    let models: string[];
    try {
      models = await fetchModels(cfg);
    } catch (e) {
      console.error(e instanceof Error ? e.message : e);
      process.exit(1);
    }

    console.log(`Models from ${name}:`);
    for (const id of models) console.log(`  ${id}`);
    return;
  }

  if (!model && args.prompt) {
    console.error("No model specified. Use --model <id> or set defaultModel in ~/.ruid/config.json");
    process.exit(1);
  }

  let provider: LLMProvider | null = null;
  if (model) {
    try {
      provider = createProvider(name, cfg);
    } catch (e) {
      if (args.prompt) {
        console.error(e instanceof Error ? e.message : e);
        process.exit(1);
      }
      provider = null; // REPL handles unconfigured mode
    }
  }

  console.log(
    provider
      ? `Provider: ${name} | Model: ${model}`
      : `No usable provider yet — starting in setup mode.`,
  );

  if (args.prompt) {
    if (!provider || !model) {
      console.error("Run `ruid setup` first (or pass --base-url/--model), then retry.");
      process.exit(1);
    }
    const { runAgentLoop } = await import("./agent/loop.js");
    await runAgentLoop({ provider, model, initialPrompt: args.prompt });
    process.stdout.write("\n");
    return;
  }

  // Fullscreen TUI needs a TTY; piped/redirected stdout gets a clear error.
  // CODINGAGENT_FORCE_TUI=1 overrides (used by tests).
  if (!process.stdout.isTTY && process.env.CODINGAGENT_FORCE_TUI !== "1") {
    console.error("Interactive mode requires a terminal (TTY). Use -p <prompt> for non-interactive runs.");
    process.exit(1);
  }

  const { startTui } = await import("./ui/controller.js");
  startTui({
    provider,
    model: model ?? "",
    resolveProvider: () => {
      const fresh = loadConfig();
      const resolved = resolveProviderConfig(args, fresh);
      const targetModel = resolveProviderModel(resolved.name, resolved.cfg, fresh, args.model);
      return { name: resolved.name, cfg: resolved.cfg, model: targetModel };
    },
  });
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
