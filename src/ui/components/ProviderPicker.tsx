import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { loadConfig, isProviderUsable } from "../../config.js";
import type { ProviderConfig } from "../../providers/types.js";

export interface ProviderEntry {
  name: string;
  config: ProviderConfig;
  usable: boolean;
  active: boolean;
  isDefault: boolean;
  defaultModel: string;
  keyInfo: string;
}

export function ProviderPicker({
  activeProviderName,
  onPick,
}: {
  activeProviderName: string;
  onPick(providerName: string | null): void;
}) {
  const [search, setSearch] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);

  const config = loadConfig();
  const allProviders: ProviderEntry[] = Object.entries(config.providers).map(([name, pcfg]) => {
    const usable = isProviderUsable(pcfg);
    const keyInfo =
      pcfg.type === "openai"
        ? pcfg.apiKey
          ? "inline key"
          : pcfg.apiKeyEnv
            ? `$${pcfg.apiKeyEnv}`
            : "no key (local)"
        : pcfg.apiKey
          ? "inline key"
          : pcfg.apiKeyEnv
            ? `$${pcfg.apiKeyEnv}`
            : "ANTHROPIC_API_KEY";

    return {
      name,
      config: pcfg,
      usable,
      active: activeProviderName === name,
      isDefault: config.default.provider === name,
      defaultModel: pcfg.defaultModel ?? (config.default.provider === name ? config.default.model : "unset"),
      keyInfo,
    };
  });

  const query = search.trim().toLowerCase();
  const isNumeric = /^\d+$/.test(query);

  const filtered =
    allProviders.length > 0
      ? query && !isNumeric
        ? allProviders.filter(
            (p) =>
              p.name.toLowerCase().includes(query) ||
              p.defaultModel.toLowerCase().includes(query) ||
              p.config.type.toLowerCase().includes(query),
          )
        : allProviders
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
      if (/^\d+$/.test(line) && allProviders.length > 0) {
        const num = parseInt(line, 10);
        if (num >= 1 && num <= allProviders.length) {
          onPick(allProviders[num - 1].name);
          return;
        }
      }
      if (filtered.length > 0) {
        onPick(filtered[clampedIdx].name);
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
          Configured LLM Providers
        </Text>
        {allProviders.length > 0 && (
          <Text dimColor>
            {query && !isNumeric
              ? `Showing ${visible.length} of ${total} matching '${query}' (${allProviders.length} total)`
              : `Showing ${startIdx + 1}-${startIdx + visible.length} of ${allProviders.length}`}
          </Text>
        )}
      </Box>

      <Text dimColor>
        Type to filter · ↑↓ scroll · Enter switch provider · Esc cancel · or type number (1-{allProviders.length})
      </Text>

      {filtered.length > 0 ? (
        <Box flexDirection="column" paddingLeft={1}>
          {above > 0 && <Text dimColor> ↑ {above} more provider{above > 1 ? "s" : ""} above</Text>}
          {visible.map((p, i) => {
            const actualIdx = startIdx + i;
            const isSelected = actualIdx === clampedIdx;
            const origIdx = allProviders.findIndex((item) => item.name === p.name) + 1;
            return (
              <Box key={p.name} flexDirection="row" gap={1}>
                <Text
                  color={isSelected ? "cyanBright" : p.active ? "green" : undefined}
                  bold={isSelected || p.active}
                >
                  {isSelected ? "> " : "  "}
                  {origIdx > 0 ? `${origIdx}) ` : ""}{p.name}
                  {p.active ? " (connected)" : p.isDefault ? " [default]" : ""}
                </Text>
                <Text dimColor>
                  [{p.defaultModel}] · {p.config.type} · {p.keyInfo}
                  {!p.usable ? " (key missing)" : ""}
                </Text>
              </Box>
            );
          })}
          {below > 0 && <Text dimColor> ↓ {below} more provider{below > 1 ? "s" : ""} below</Text>}
        </Box>
      ) : (
        <Box paddingLeft={1}>
          <Text color="yellow">No providers matching &quot;{query}&quot;</Text>
        </Box>
      )}

      <Box paddingLeft={1}>
        <Text color="cyan">{"> "} </Text>
        <Text>{search}</Text>
        <Text dimColor>▌</Text>
      </Box>
    </Box>
  );
}
