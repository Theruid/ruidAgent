import React, { useEffect, useState } from "react";
import { Box, Text } from "ink";
import { formatDuration } from "../utils/pricing.js";
import { truncateLine } from "../utils/wrap.js";

export const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/** Standalone animated spinner glyph — used for in-transcript pending rows. */
export function Spinner({ color = "cyan" }: { color?: string }) {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setFrame((f) => f + 1), 90);
    return () => clearInterval(timer);
  }, []);

  return <Text color={color}>{SPINNER_FRAMES[frame % SPINNER_FRAMES.length]}</Text>;
}

/**
 * Live "the agent is working" row.
 *
 * It owns its own animation timer, so the spinner and elapsed counter keep
 * moving even when no store event arrives (e.g. while waiting for the model's
 * first token). Because the interval lives here, only this row re-renders —
 * the message list behind it stays untouched.
 */
export function ActivityIndicator({
  label,
  detail,
  startedAt,
  tokens,
  columns,
  paused = false,
}: {
  label: string;
  detail?: string;
  startedAt: number;
  /** Approximate number of output tokens produced so far. */
  tokens?: number;
  columns?: number;
  /** True while blocked on a permission prompt: spinner freezes. */
  paused?: boolean;
}) {
  const [frame, setFrame] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => {
      setFrame((f) => f + 1);
      setNow(Date.now());
    }, 90);
    return () => clearInterval(timer);
  }, []);

  const elapsed = Math.max(0, now - startedAt);
  const glyph = paused ? "⏸" : SPINNER_FRAMES[frame % SPINNER_FRAMES.length];
  const meta = [formatDuration(elapsed), tokens && tokens > 0 ? `~${tokens} tok` : ""]
    .filter(Boolean)
    .join(" · ");

  const head = detail ? `${label} · ${detail}` : label;
  const budget = Math.max(12, (columns ?? 80) - 4 - Array.from(meta).length - 2);

  return (
    <Box>
      <Text color={paused ? "yellow" : "cyan"}>{glyph} </Text>
      <Text bold={!paused} dimColor={paused}>
        {truncateLine(head, budget)}
      </Text>
      <Text dimColor> · {meta}</Text>
    </Box>
  );
}
