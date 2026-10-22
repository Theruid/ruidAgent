import React from "react";
import { Box, Text } from "ink";
import type { SessionUsage } from "../store.js";
import type { AgentMode } from "../../permissions.js";
import type { ModelCapabilities } from "../../providers/types.js";
import { formatTokenCount, formatCost, formatLatency, hasKnownPricing } from "../utils/pricing.js";
import { truncateLine } from "../utils/wrap.js";

export interface StatusBarParts {
  mode: string;
  model: string;
  ctx: string;
  usage: string;
  right: string;
}

/**
 * Builds the status bar text so it fits in `width` cells on one line,
 * dropping the least important pieces first: integrations, cache detail,
 * latency, token counts, the thinking badge, then truncating the model.
 */
export function layoutStatusBar(
  width: number,
  p: {
    modeLabel: string;
    connected: boolean;
    providerName: string;
    model: string;
    thinkingBadge: string;
    ctx: string;
    tokens: string;
    cached: string;
    cost: string;
    latency: string;
    right: string;
  },
): StatusBarParts {
  const GAP = 2;
  const modelText = (think: string) =>
    p.connected ? `${p.providerName} · ${p.model || "(no model)"}${think}` : "not connected — /setup";
  const usageText = (tokens: boolean, cached: boolean, latency: boolean) =>
    [tokens ? `${p.tokens}${cached ? p.cached : ""}` : "", p.cost, latency ? p.latency : ""]
      .filter(Boolean)
      .join(" · ");

  // Most to least detailed; the first variant that fits wins.
  const variants: Array<{ think: boolean; tokens: boolean; cached: boolean; latency: boolean; right: boolean }> = [
    { think: true, tokens: true, cached: true, latency: true, right: true },
    { think: true, tokens: true, cached: true, latency: true, right: false },
    { think: true, tokens: true, cached: false, latency: true, right: false },
    { think: true, tokens: true, cached: false, latency: false, right: false },
    { think: true, tokens: false, cached: false, latency: false, right: false },
    { think: false, tokens: false, cached: false, latency: false, right: false },
  ];
  const length = (s: string) => Array.from(s).length;

  for (const v of variants) {
    const model = modelText(v.think ? p.thinkingBadge : "");
    const usage = usageText(v.tokens, v.cached, v.latency);
    const right = v.right ? p.right : "";
    const segments = [`${p.modeLabel} ${model}${p.ctx}`, usage, right].filter(Boolean);
    const total = segments.reduce((sum, s) => sum + length(s), 0) + GAP * (segments.length - 1);
    if (total <= width) return { mode: p.modeLabel, model, ctx: p.ctx, usage, right };
  }

  // Still too wide: keep mode, ctx and cost, and truncate the model name.
  const usage = p.cost;
  const budget = width - length(p.modeLabel) - 1 - length(p.ctx) - (usage ? length(usage) + GAP : 0);
  return { mode: p.modeLabel, model: truncateLine(modelText(""), Math.max(4, budget)), ctx: p.ctx, usage, right: "" };
}

export function StatusBar({
  providerName,
  model,
  connected,
  capabilities,
  thinkingEnabled,
  mode = "code",
  taskCount = 0,
  mcpCount = 0,
  skillCount = 0,
  usage,
  lastTurnLatencyMs,
  columns = 80,
}: {
  providerName: string;
  model: string;
  connected: boolean;
  capabilities?: ModelCapabilities;
  thinkingEnabled?: boolean;
  msgCount?: number;
  mode?: AgentMode;
  taskCount?: number;
  mcpCount?: number;
  skillCount?: number;
  usage?: SessionUsage;
  lastTurnLatencyMs?: number;
  version?: string;
  /** Terminal width; the bar drops detail to stay on one line. */
  columns?: number;
}) {
  const hasUsage = Boolean(usage && (usage.inputTokens > 0 || usage.outputTokens > 0));

  let modeColor = "cyan";
  let modeLabel = "CODE";
  if (mode === "plan") {
    modeColor = "magenta";
    modeLabel = "PLAN";
  } else if (mode === "auto") {
    modeColor = "green";
    modeLabel = "AUTO";
  }

  const thinkingBadge = capabilities?.supportsThinking
    ? thinkingEnabled === false
      ? " · [think:off]"
      : " · [think]"
    : "";

  const contextLimit = capabilities?.contextWindow ?? 128_000;
  const currentTokens = usage?.contextTokens ?? 0;
  const contextPct = Math.min(100, Math.round((currentTokens / contextLimit) * 100));
  const contextColor = contextPct > 85 ? "red" : contextPct > 70 ? "yellow" : "cyan";

  const rightItems: string[] = [];
  if (mcpCount > 0) rightItems.push(`⚡ ${mcpCount} MCP`);
  if (skillCount > 0) rightItems.push(`${skillCount} skills`);
  if (taskCount > 0) rightItems.push(`${taskCount} tasks`);

  // Unknown models (local or custom endpoints) have no price table entry.
  const showCost = hasUsage && (hasKnownPricing(model) || (usage?.totalCost ?? 0) > 0);

  const parts = layoutStatusBar(Math.max(20, columns - 4), {
    modeLabel: `[${modeLabel}]`,
    connected,
    providerName,
    model,
    thinkingBadge,
    ctx: currentTokens > 0 ? ` · ctx ${contextPct}%` : "",
    tokens: hasUsage && usage ? `${formatTokenCount(usage.inputTokens)} in · ${formatTokenCount(usage.outputTokens)} out` : "",
    cached: usage?.cacheReadInputTokens ? ` · ${formatTokenCount(usage.cacheReadInputTokens)} cached` : "",
    cost: showCost && usage ? formatCost(usage.totalCost) : "",
    latency: hasUsage && lastTurnLatencyMs ? formatLatency(lastTurnLatencyMs) : "",
    right: rightItems.join(" · "),
  });

  return (
    <Box justifyContent="space-between" paddingX={1} marginTop={0}>
      <Box>
        <Text color={modeColor} bold>
          {parts.mode}
        </Text>
        <Text dimColor> {parts.model}</Text>
        {parts.ctx && <Text color={contextColor}>{parts.ctx}</Text>}
      </Box>

      {parts.usage && (
        <Box>
          <Text dimColor>{parts.usage}</Text>
        </Box>
      )}

      {parts.right && (
        <Box>
          <Text dimColor>{parts.right}</Text>
        </Box>
      )}
    </Box>
  );
}
