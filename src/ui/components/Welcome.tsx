import React from "react";
import { Box, Text } from "ink";

export function Welcome({ connected }: { connected: boolean }) {
  return (
    <Box flexDirection="column" alignItems="center" gap={1}>
      <Box flexDirection="column" alignItems="center">
        <Text bold color="cyan">
          ◆ ruid (@theruid/ruid)
        </Text>
        {!connected && (
          <Text dimColor>No provider configured yet — run /setup to connect one.</Text>
        )}
      </Box>
      <Box flexDirection="column" alignItems="center" marginTop={1}>
        <Text dimColor>Tab: cycle modes · @file: attach file · Ctrl+Enter: newline</Text>
        <Text dimColor>/new: new chat · /tasks: plan · /rollback: undo · /exit: quit</Text>
      </Box>
    </Box>
  );
}
