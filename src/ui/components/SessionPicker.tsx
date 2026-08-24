import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { listSessions, type StoredSession } from "../../sessions.js";

function relTime(ts: number): string {
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}

export function SessionPicker({ onPick }: { onPick(id: string | null): void }) {
  const [sessions] = useState<StoredSession[]>(() => listSessions());
  const [idx, setIdx] = useState(0);

  useInput((input, key) => {
    if (sessions.length === 0) {
      if (key.escape || key.return) onPick(null);
      return;
    }
    if (key.upArrow || input === "k") setIdx((i) => Math.max(0, i - 1));
    else if (key.downArrow || input === "j") setIdx((i) => Math.min(sessions.length - 1, i + 1));
    else if (key.return) onPick(sessions[idx].id);
    else if (key.escape) onPick(null);
  });

  return (
    <Box borderStyle="round" paddingX={1} flexDirection="column">
      <Box justifyContent="space-between">
        <Text bold> Sessions</Text>
        <Text dimColor>↑↓ select · Enter open · Esc cancel</Text>
      </Box>
      {sessions.length === 0 ? (
        <Text dimColor> No saved sessions yet.</Text>
      ) : (
        sessions.slice(0, Math.max(3, Math.min(8, (process.stdout.rows ?? 30) - 6))).map((s, i) => (
          <Box key={s.id} paddingLeft={1}>
            <Text color={i === idx ? "cyan" : undefined}>
              {i === idx ? "> " : "  "}
              {s.title.slice(0, 40).padEnd(42)}
              <Text dimColor>
                {relTime(s.updatedAt).padEnd(10)} {s.messages.length} msgs
              </Text>
            </Text>
          </Box>
        ))
      )}
    </Box>
  );
}
