import React from "react";
import { Box, Text } from "ink";
import type { SessionUsage } from "../store.js";
import type { AgentMode } from "../../permissions.js";
import type { ModelCapabilities } from "../../providers/types.js";
import { formatTokenCount, formatCost, formatLatency, hasKnownPricing } from "../utils/pricing.js";

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
}) {
  const hasUsage = usage && (usage.inputTokens > 0 || usage.outputTokens > 0);
  const inStr = usage ? formatTokenCount(usage.inputTokens) : "0";
  const cachedStr = usage?.cacheReadInputTokens ? ` (${formatTokenCount(usage.cacheReadInputTokens)} cached)` : "";
  const outStr = usage ? formatTokenCount(usage.outputTokens) : "0";
  // Unknown models (local or custom endpoints) have no price table entry.
  const costStr = hasKnownPricing(model) || (usage?.totalCost ?? 0) > 0 ? ` · ${formatCost(usage?.totalCost ?? 0)}` : "";
  const latencyStr = lastTurnLatencyMs ? formatLatency(lastTurnLatencyMs) : null;

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
  const contextStr = currentTokens > 0 ? ` · ctx ${contextPct}%` : "";

  const rightItems: string[] = [];
  if (mcpCount > 0) rightItems.push(`⚡ ${mcpCount} MCP`);
  if (skillCount > 0) rightItems.push(`${skillCount} skills`);
  if (taskCount > 0) rightItems.push(`${taskCount} tasks`);
  const rightStr = rightItems.join(" · ");
  const showRight = rightStr.length > 0;

  return (
    <Box justifyContent="space-between" paddingX={1} marginTop={0}>
      <Box>
        <Text color={modeColor} bold>
          [{modeLabel}]
        </Text>
        <Text dimColor>
          {" "}{connected ? `${providerName} · ${model || "(no model)"}${thinkingBadge}` : "not connected — /setup"}
        </Text>
        {currentTokens > 0 && (
          <Text color={contextColor}>
            {contextStr}
          </Text>
        )}
      </Box>

      {hasUsage && (
        <Box>
          <Text dimColor>
            {inStr} in{cachedStr} · {outStr} out{costStr}
            {latencyStr ? ` · ${latencyStr}` : ""}
          </Text>
        </Box>
      )}

      {showRight && (
        <Box>
          <Text dimColor>
            {rightStr}
          </Text>
        </Box>
      )}
    </Box>
  );
}
