import React, { useSyncExternalStore } from "react";
import { Box, Text } from "ink";
import { formatDuration } from "../utils/pricing.js";
import { truncateLine } from "../utils/wrap.js";

export const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/** Animation period. Every spinner shares it, so a tick costs one frame, not one per spinner. */
export const TICK_MS = 120;

/**
 * One process-wide animation clock. Each spinner owning its own setInterval
 * meant N spinners caused N redraws per period — on Windows consoles every
 * redraw is visible — so they all subscribe to this single ticker instead.
 * The interval only runs while something is subscribed.
 */
const ticker = (() => {
  let tick = 0;
  let timer: ReturnType<typeof setInterval> | null = null;
  const listeners = new Set<() => void>();
  return {
    subscribe(fn: () => void): () => void {
      listeners.add(fn);
      if (!timer) {
        timer = setInterval(() => {
          tick++;
          for (const l of listeners) l();
        }, TICK_MS);
      }
      return () => {
        listeners.delete(fn);
        if (listeners.size === 0 && timer) {
          clearInterval(timer);
          timer = null;
        }
      };
    },
    get: () => tick,
  };
})();

/** Current animation frame number; re-renders the caller on each shared tick. */
export function useTick(): number {
  return useSyncExternalStore(ticker.subscribe, ticker.get);
}

/** Standalone animated spinner glyph — used for in-transcript pending rows. */
export function Spinner({ color = "cyan" }: { color?: string }) {
  const frame = useTick();
  return <Text color={color}>{SPINNER_FRAMES[frame % SPINNER_FRAMES.length]}</Text>;
}

/**
 * Live "the agent is working" row.
 *
 * Driven by the shared ticker, so the spinner and elapsed counter keep moving
 * even when no store event arrives (e.g. while waiting for the model's first
 * token), and only this row re-renders — the message list behind it stays
 * untouched.
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
  const frame = useTick();
  const now = Date.now();

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
