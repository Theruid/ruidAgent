import React from "react";
import { Box, Text } from "ink";

const RUID_LOGO = `   ____    __  __    ____    ____
  / __ \\  / / / /   /  _/   / __ \\
 / /_/ / / / / /    / /    / / / /
/ _, _/ / /_/ /   _/ /    / /_/ /
/_/ |_|  \\____/   /___/   /_____/  `;

export function Welcome({ connected }: { connected: boolean }) {
  return (
    <Box flexDirection="column" alignItems="center" gap={1}>
      <Text bold color="cyan">
        {RUID_LOGO}
      </Text>
      {!connected && (
        <Text dimColor>No provider configured yet — run /setup to connect one.</Text>
      )}
    </Box>
  );
}
