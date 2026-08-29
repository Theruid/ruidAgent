import React from "react";
import { Box, Text } from "ink";

const RUID_LOGO = ` ____   _   _  ___  ____
|  _ \\ | | | ||_ _||  _ \\
| |_) || | | | | | | | | |
|  _ < | |_| | | | | |_| |
|_| \\_\\ \\___/ |___||____/ `;

export function Welcome({ connected, version }: { connected: boolean; version?: string }) {
  return (
    <Box flexDirection="column" alignItems="center" gap={1}>
      <Text bold color="cyan">
        {RUID_LOGO}
      </Text>
      {version && (
        <Text dimColor>v{version}</Text>
      )}
      {!connected && (
        <Text dimColor>No provider configured yet — run /setup to connect one.</Text>
      )}
    </Box>
  );
}
