import React, { useState, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import { fetchModels } from "../../configWizard.js";
import type { ProviderConfig } from "../../providers/types.js";
import { resolveModelCapabilities, formatCapabilityBadge } from "../../providers/capabilities.js";

export function ModelPicker({
  providerName,
  providerConfig,
  currentModel,
  onPick,
}: {
  providerName: string;
  providerConfig?: ProviderConfig;
  currentModel: string;
  onPick(model: string | null): void;
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [allModels, setAllModels] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        if (!providerConfig) {
          throw new Error(`Provider "${providerName}" is not configured.`);
        }
        const fetched = await fetchModels(providerConfig);
        if (!cancelled) {
          setAllModels(fetched);
          const initialIdx = fetched.indexOf(currentModel);
          if (initialIdx >= 0) setSelectedIndex(initialIdx);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [providerName, providerConfig, currentModel]);

  const query = search.trim().toLowerCase();
  const isNumeric = /^\d+$/.test(query);

  const filtered =
    allModels.length > 0
      ? query && !isNumeric
        ? allModels.filter((m) => m.toLowerCase().includes(query))
        : allModels
      : [];

  const maxVisible = 10;
  const total = filtered.length;
  const clampedIdx = Math.min(Math.max(0, selectedIndex), Math.max(0, total - 1));
  const startIdx = Math.max(
    0,
    Math.min(clampedIdx - Math.floor(maxVisible / 2), total - maxVisible),
  );
  const visible = filtered.slice(startIdx, startIdx + maxVisible);
  const above = startIdx;
  const below = Math.max(0, total - (startIdx + visible.length));

  useInput((data, key) => {
    if (loading) {
      if (key.escape) onPick(null);
      return;
    }

    if (error) {
      if (key.escape || key.return) onPick(null);
      return;
    }

    if (key.escape) {
      if (search.length > 0) {
        setSearch("");
        setSelectedIndex(0);
        return;
      }
      onPick(null);
      return;
    }

    if (key.upArrow) {
      setSelectedIndex((i) => Math.max(0, i - 1));
      return;
    }
    if (key.downArrow) {
      setSelectedIndex((i) => Math.min(total - 1, i + 1));
      return;
    }
    if (key.pageUp) {
      setSelectedIndex((i) => Math.max(0, i - maxVisible));
      return;
    }
    if (key.pageDown) {
      setSelectedIndex((i) => Math.min(total - 1, i + maxVisible));
      return;
    }

    if (key.backspace || key.delete) {
      setSearch((s) => {
        const next = s.slice(0, -1);
        setSelectedIndex(0);
        return next;
      });
      return;
    }

    if (key.return) {
      const line = search.trim();
      if (/^\d+$/.test(line) && allModels.length > 0) {
        const num = parseInt(line, 10);
        if (num >= 1 && num <= allModels.length) {
          onPick(allModels[num - 1]);
          return;
        }
      }
      if (filtered.length > 0) {
        onPick(filtered[clampedIdx]);
        return;
      }
      onPick(null);
      return;
    }

    if (key.ctrl) return;
    setSearch((s) => {
      const next = s + data.replace(/\r?\n/g, "");
      setSelectedIndex(0);
      return next;
    });
  });

  return (
    <Box borderStyle="round" borderColor="cyan" paddingX={1} flexDirection="column">
      <Box justifyContent="space-between">
        <Text bold color="cyan">
          Select model for &quot;{providerName}&quot;
        </Text>
        {!loading && !error && allModels.length > 0 && (
          <Text dimColor>
            {query && !isNumeric
              ? `Showing ${visible.length} of ${total} matching '${query}' (${allModels.length} total)`
              : `Showing ${startIdx + 1}-${startIdx + visible.length} of ${allModels.length}`}
          </Text>
        )}
      </Box>

      {loading && <Text dimColor>Fetching available models from endpoint…</Text>}
      {error && (
        <Box flexDirection="column">
          <Text color="red">Failed to list models: {error}</Text>
          <Text dimColor>Press Enter or Esc to cancel.</Text>
        </Box>
      )}

      {!loading && !error && (
        <>
          <Text dimColor>
            Type to filter · ↑↓ scroll · Enter select · Esc cancel · or type number (1-{allModels.length})
          </Text>
          {filtered.length > 0 ? (
            <Box flexDirection="column" paddingLeft={1}>
              {above > 0 && <Text dimColor> ↑ {above} more model{above > 1 ? "s" : ""} above</Text>}
              {visible.map((m, i) => {
                const actualIdx = startIdx + i;
                const isSelected = actualIdx === clampedIdx;
                const isCurrent = m === currentModel;
                const origIdx = allModels.indexOf(m) + 1;
                const providerType = providerConfig?.type ?? "openai";
                const caps = resolveModelCapabilities(providerType, m, providerConfig);
                const badge = formatCapabilityBadge(caps);

                return (
                  <Box key={m} justifyContent="space-between">
                    <Text
                      color={isSelected ? "cyanBright" : isCurrent ? "green" : undefined}
                      bold={isSelected || isCurrent}
                    >
                      {isSelected ? "> " : "  "}
                      {origIdx > 0 ? `${origIdx}) ` : ""}{m}
                      {isCurrent ? " (active)" : ""}
                    </Text>
                    <Text dimColor> {badge}</Text>
                  </Box>
                );
              })}
              {below > 0 && <Text dimColor> ↓ {below} more model{below > 1 ? "s" : ""} below</Text>}
            </Box>
          ) : (
            <Box paddingLeft={1}>
              <Text color="yellow">No models matching &quot;{query}&quot;</Text>
            </Box>
          )}

          <Box paddingLeft={1}>
            <Text color="cyan">{"> "} </Text>
            <Text>{search}</Text>
            <Text dimColor>▌</Text>
          </Box>
        </>
      )}
    </Box>
  );
}
