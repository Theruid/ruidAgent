import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { searchSessions, type StoredSession } from "../../sessions.js";

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
  const [query, setQuery] = useState("");
  const [idx, setIdx] = useState(0);

  const filteredSessions = searchSessions(query);

  useInput((input, key) => {
    if (key.escape) {
      onPick(null);
      return;
    }

    if (key.return) {
      if (filteredSessions.length > 0 && filteredSessions[idx]) {
        onPick(filteredSessions[idx].id);
      } else {
        onPick(null);
      }
      return;
    }

    if (key.upArrow) {
      setIdx((i) => Math.max(0, i - 1));
      return;
    }

    if (key.downArrow) {
      setIdx((i) => Math.min(Math.max(0, filteredSessions.length - 1), i + 1));
      return;
    }

    if (key.backspace || key.delete) {
      setQuery((q) => q.slice(0, -1));
      setIdx(0);
      return;
    }

    // Normal typing for search filter
    if (input && !key.ctrl && !key.meta) {
      setQuery((q) => q + input);
      setIdx(0);
    }
  });

  const maxVisible = Math.max(3, Math.min(8, (process.stdout.rows ?? 30) - 8));
  const startIdx = Math.max(0, Math.min(idx - Math.floor(maxVisible / 2), Math.max(0, filteredSessions.length - maxVisible)));
  const visible = filteredSessions.slice(startIdx, startIdx + maxVisible);

  return (
    <Box borderStyle="round" borderColor="cyan" paddingX={1} flexDirection="column">
      <Box justifyContent="space-between" marginBottom={0}>
        <Box>
          <Text bold color="cyan">Resume Session: </Text>
          <Text color="white">{query}</Text>
          <Text dimColor>█</Text>
        </Box>
        <Text dimColor>↑↓ select · Enter open · Esc cancel</Text>
      </Box>

      {filteredSessions.length === 0 ? (
        <Box paddingLeft={1} paddingTop={1}>
          <Text dimColor>{query ? "No sessions match your search." : "No saved sessions yet."}</Text>
        </Box>
      ) : (
        visible.map((s, i) => {
          const actualIdx = startIdx + i;
          const isSelected = actualIdx === idx;
          const snippetText = s.snippet ? ` — "${s.snippet}"` : "";
          return (
            <Box key={s.id} paddingLeft={1} justifyContent="space-between">
              <Box>
                <Text color={isSelected ? "cyanBright" : undefined} bold={isSelected}>
                  {isSelected ? "> " : "  "}
                  {s.title.slice(0, 38).padEnd(40)}
                </Text>
                {snippetText && <Text dimColor>{snippetText.slice(0, 30)}</Text>}
              </Box>
              <Text dimColor>
                {relTime(s.updatedAt).padEnd(8)} {s.messages.length} msgs
              </Text>
            </Box>
          );
        })
      )}
    </Box>
  );
}
