import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import type { UpdateInfo } from "../../updater.js";
import { performUpdate } from "../../updater.js";

export function UpdatePrompt({
  info,
  onDismiss,
}: {
  info: UpdateInfo;
  onDismiss: () => void;
}) {
  const [updating, setUpdating] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  useInput((input) => {
    if (updating) return;
    const lower = input.toLowerCase().trim();
    if (lower === "y") {
      setUpdating(true);
      setStatus(`Updating ${info.packageName} via npm…`);
      performUpdate(info.packageName).then((res) => {
        if (res.success) {
          setStatus(`✓ Updated to v${info.latestVersion}! Please restart ruid.`);
          setTimeout(() => {
            onDismiss();
          }, 3000);
        } else {
          setStatus(`✖ Update failed: ${res.output.slice(0, 120)}`);
          setTimeout(() => {
            onDismiss();
          }, 4000);
        }
      });
    } else if (lower === "n" || lower === " " || input === "\x1b" || input === "\r") {
      onDismiss();
    }
  });

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
