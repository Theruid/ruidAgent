import React, { useState, useEffect } from "react";
import { Box, Text } from "ink";
import type { SessionUsage } from "../store.js";
import type { AgentMode } from "../../permissions.js";
import { formatTokenCount, formatCost, formatLatency } from "../utils/pricing.js";

const SPIN = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏";

export function StatusBar({
  providerName,
  model,
  connected,
  msgCount,
  running,
  mode = "code",
  taskCount = 0,
  mcpCount = 0,
  usage,
  lastTurnLatencyMs,
}: {
  providerName: string;
  model: string;
  connected: boolean;
  msgCount: number;
  running: boolean;
  mode?: AgentMode;
  taskCount?: number;
  mcpCount?: number;
  usage?: SessionUsage;
  lastTurnLatencyMs?: number;
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

  return (
    <Box justifyContent="space-between" paddingX={1} marginTop={0}>
      <Box>
        <Text color={modeColor} bold>
          [{modeLabel}]
        </Text>
        <Text dimColor>
          {" "}{connected ? `${providerName} · ${model || "(no model)"}` : "not connected — /setup"}
        </Text>
      </Box>

      {hasUsage && (
        <Box>
          <Text dimColor>
            {inStr} in{cachedStr} · {outStr} out · {costStr}
            {latencyStr ? ` · ${latencyStr}` : ""}
          </Text>
        </Box>
      )}

      <Box>
        <Text dimColor>
          {running ? `${SPIN[frame % SPIN.length]} ` : ""}
          {mcpCount > 0 ? `⚡ ${mcpCount} MCP · ` : ""}
          {taskCount > 0 ? `${taskCount} tasks · ` : ""}
          {msgCount} msgs · <Text color="yellow">Tab: mode</Text>
        </Text>
      </Box>
    </Box>
  );
}
