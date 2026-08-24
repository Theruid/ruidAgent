import React, { useState, useEffect } from "react";
import { Box, Text } from "ink";
import type { SessionUsage } from "../store.js";
import { formatTokenCount, formatCost, formatLatency } from "../utils/pricing.js";

const SPIN = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏";

export function StatusBar({
  providerName,
  model,
  connected,
  msgCount,
  running,
  usage,
  lastTurnLatencyMs,
}: {
  providerName: string;
  model: string;
  connected: boolean;
  msgCount: number;
  running: boolean;
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
  const outStr = usage ? formatTokenCount(usage.outputTokens) : "0";
  const costStr = usage ? formatCost(usage.totalCost) : "$0.00";
  const latencyStr = lastTurnLatencyMs ? formatLatency(lastTurnLatencyMs) : null;

  return (
    <Box justifyContent="space-between" paddingX={1} marginTop={0}>
      <Box>
        <Text dimColor>
          {connected ? `${providerName} · ${model || "(no model)"}` : "not connected — /setup"}
        </Text>
      </Box>

      {hasUsage && (
        <Box>
          <Text dimColor>
            {inStr} in · {outStr} out · {costStr}
            {latencyStr ? ` · ${latencyStr}` : ""}
          </Text>
        </Box>
      )}

      <Box>
        <Text dimColor>
          {running ? `${SPIN[frame % SPIN.length]} ` : ""}
          {msgCount} msgs
        </Text>
      </Box>
    </Box>
  );
}
