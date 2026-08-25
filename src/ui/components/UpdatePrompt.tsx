import React from "react";
import { Box, Text } from "ink";
import type { UpdateInfo } from "../../updater.js";

export function UpdatePrompt({
  info,
  status,
}: {
  info: UpdateInfo;
  status: string | null;
}) {
  return (
    <Box
      borderStyle="round"
      borderColor="green"
      flexDirection="column"
      paddingX={1}
      marginBottom={1}
    >
      <Box justifyContent="space-between">
        <Text bold color="green">
          🚀 Update Available: v{info.currentVersion} → v{info.latestVersion}
        </Text>
      </Box>
      <Box marginTop={0}>
        {status ? (
          <Text color="yellow">{status}</Text>
        ) : (
          <Text>
            A new version of <Text bold>{info.packageName}</Text> is available on npm. Update now? (<Text bold color="green">y</Text>/<Text bold color="red">n</Text>)
          </Text>
        )}
      </Box>
    </Box>
  );
}
