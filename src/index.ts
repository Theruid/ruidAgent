#!/usr/bin/env node
import React from "react";
import { loadConfig, resolveProviderModel } from "./config.js";
import { createAnthropicProvider } from "./providers/anthropic.js";
import { createOpenAIProvider } from "./providers/openai.js";
import type { LLMProvider, ProviderConfig } from "./providers/types.js";

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

async function main(): Promise<void> {
  const arg = process.argv[2];
  if (arg === "-h" || arg === "--help") {
    console.log(`ruid (@theruid/ruid) — Autonomous terminal coding agent

Usage:
  ruid          Launch interactive coding agent
  ruid setup    Run interactive provider setup wizard
`);
    return;
  }

  if (arg === "setup") {
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
  const name = config.default.provider;
  const cfg = config.providers[name];
  const model = resolveProviderModel(name, cfg, config);

  let provider: LLMProvider | null = null;
  if (model && cfg) {
    try {
      provider = createProvider(name, cfg);
    } catch {
      provider = null;
    }
  }

  // Fullscreen TUI requires TTY; RUID_FORCE_TUI=1 overrides for tests
  if (!process.stdout.isTTY && process.env.RUID_FORCE_TUI !== "1") {
    console.error("Interactive mode requires a terminal (TTY).");
    process.exit(1);
  }

  const { startTui } = await import("./ui/controller.js");
  startTui({
    provider,
    model: model ?? "",
    resolveProvider: () => {
      const fresh = loadConfig();
      const freshName = fresh.default.provider;
      const freshCfg = fresh.providers[freshName];
      const targetModel = resolveProviderModel(freshName, freshCfg, fresh);
      return { name: freshName, cfg: freshCfg, model: targetModel };
    },
  });
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
