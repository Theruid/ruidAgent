#!/usr/bin/env node
import React from "react";
import { loadConfig, resolveProviderModel } from "./config.js";
import { createAnthropicProvider } from "./providers/anthropic.js";
import { createOpenAIProvider } from "./providers/openai.js";
import type { LLMProvider, ProviderConfig } from "./providers/types.js";
import { runAgentLoop } from "./agent/loop.js";
import { createDeferredPermissions } from "./permissions.js";

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

async function runHeadless(prompt: string, args: string[]): Promise<void> {
  const isJson = args.includes("--json");
  const maxTurnsIdx = args.indexOf("--max-turns");
  const maxTurns = maxTurnsIdx !== -1 && args[maxTurnsIdx + 1] ? parseInt(args[maxTurnsIdx + 1], 10) : 25;

  const modelIdx = args.indexOf("--model");
  const overrideModel = modelIdx !== -1 && args[modelIdx + 1] ? args[modelIdx + 1] : undefined;

  const config = loadConfig();
  const name = config.default.provider;
  const cfg = config.providers[name];
  const model = overrideModel ?? resolveProviderModel(name, cfg, config);

  if (!cfg || !model) {
    console.error("No active provider or model configured. Run `ruid setup` first.");
    process.exit(1);
  }

  const provider = createProvider(name, cfg);
  const permissions = createDeferredPermissions(new Set(["read_file", "write_file", "edit_file", "glob", "grep", "list_dir", "bash", "git_status", "git_diff", "git_log"]), "auto").manager;

  const events: Array<{ type: string; data: any }> = [];

  try {
    const messages = await runAgentLoop({
      provider,
      model,
      initialPrompt: prompt,
      maxIterations: maxTurns,
      permissions,
      onEvent: (evt) => {
        if (isJson) {
          events.push({ type: evt.type, data: evt });
        } else {
          if (evt.type === "text_delta") {
            process.stdout.write(evt.text);
          } else if (evt.type === "tool_start") {
            console.log(`\n[Tool: ${evt.name}]`);
          }
        }
      },
    });

    if (isJson) {
      console.log(JSON.stringify({ success: true, messages, events }, null, 2));
    } else {
      console.log("\n");
    }
    process.exit(0);
  } catch (err: any) {
    if (isJson) {
      console.log(JSON.stringify({ success: false, error: err.message, events }, null, 2));
    } else {
      console.error(`\nError: ${err.message}`);
    }
    process.exit(1);
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const arg = args[0];

  if (arg === "-v" || arg === "--version" || arg === "-V") {
    const { getLocalPackageInfo } = await import("./updater.js");
    const { version } = getLocalPackageInfo();
    console.log(`ruid v${version}`);
    return;
  }

  if (arg === "-h" || arg === "--help") {
    console.log(`ruid (@theruid/ruid) — Autonomous terminal coding agent

Usage:
  ruid                       Launch interactive coding agent
  ruid -p, --print <prompt>  Run in headless non-interactive mode
  ruid setup                 Run interactive provider setup wizard
  ruid --version             Show current version

Options (headless):
  --json                     Output structured JSON result
  --max-turns <N>            Maximum tool call iterations (default 25)
  --model <model>            Override target model
`);
    return;
  }

  // Headless mode trigger: ruid -p "<prompt>" or ruid --print "<prompt>"
  const printIdx = args.findIndex((a) => a === "-p" || a === "--print");
  if (printIdx !== -1) {
    const prompt = args[printIdx + 1];
    if (!prompt) {
      console.error("Error: -p / --print requires a prompt string.");
      process.exit(1);
    }
    await runHeadless(prompt, args);
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
    console.error("Interactive mode requires a terminal (TTY). Use -p / --print for non-interactive execution.");
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
