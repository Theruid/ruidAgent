import React from "react";
import { Box, Text } from "ink";

export function Welcome({ connected }: { connected: boolean }) {
  return (
    <Box flexDirection="column" alignItems="center" gap={1}>
      <Box flexDirection="column" alignItems="center">
        <Text bold color="cyan">
          ◆ codingagent
        </Text>
        {!connected && (
          <Text dimColor>No provider configured yet — run /setup to connect one.</Text>
        )}
      </Box>
      <Box flexDirection="column" alignItems="center" marginTop={1}>
        <Text dimColor>Type a message · /new new chat · /resume pick a session</Text>
        <Text dimColor>/setup providers · /model switch model · /exit quit</Text>
      </Box>
    </Box>
  );
}
