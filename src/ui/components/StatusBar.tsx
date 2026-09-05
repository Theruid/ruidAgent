import React, { useState, useEffect } from "react";
import { Box, Text } from "ink";
import type { SessionUsage } from "../store.js";
import type { AgentMode } from "../../permissions.js";
import type { ModelCapabilities } from "../../providers/types.js";
import { formatTokenCount, formatCost, formatLatency } from "../utils/pricing.js";

const SPIN = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏";

export function StatusBar({
  providerName,
  model,
  connected,
  capabilities,
  thinkingEnabled,
  running,
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
  running: boolean;
  mode?: AgentMode;
  taskCount?: number;
  mcpCount?: number;
  skillCount?: number;
  usage?: SessionUsage;
  lastTurnLatencyMs?: number;
  version?: string;
}) {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setFrame((f) => f + 1), 120);
    return () => clearInterval(t);
  }, [running]);

  const hasUsage = usage && (usage.inputTokens > 0 || usage.outputTokens > 0);
  const inStr = usage ? formatTokenCount(usage.inputTokens) : "0";
  const cachedStr = usage?.cacheReadInputTokens ? ` (${formatTokenCount(usage.cacheReadInputTokens)} cached)` : "";
  const outStr = usage ? formatTokenCount(usage.outputTokens) : "0";
  const costStr = usage ? formatCost(usage.totalCost) : "$0.00";
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
  const currentTokens = usage?.inputTokens ?? 0;
  const contextPct = Math.min(100, Math.round((currentTokens / contextLimit) * 100));
  const contextColor = contextPct > 85 ? "red" : contextPct > 70 ? "yellow" : "cyan";
  const contextStr = currentTokens > 0 ? ` · ctx ${contextPct}%` : "";

  const rightItems: string[] = [];
  if (mcpCount > 0) rightItems.push(`⚡ ${mcpCount} MCP`);
  if (skillCount > 0) rightItems.push(`${skillCount} skills`);
  if (taskCount > 0) rightItems.push(`${taskCount} tasks`);
  const rightStr = rightItems.join(" · ");
  const showRight = running || rightStr.length > 0;

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
            {inStr} in{cachedStr} · {outStr} out · {costStr}
            {latencyStr ? ` · ${latencyStr}` : ""}
          </Text>
        </Box>
      )}

      {showRight && (
        <Box>
          <Text dimColor>
            {running ? `${SPIN[frame % SPIN.length]}${rightStr ? " " : ""}` : ""}
            {rightStr}
          </Text>
        </Box>
      )}
    </Box>
  );
}
