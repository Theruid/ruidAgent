import React from "react";
import { Box, Text } from "ink";

export function FilePalette({
  files,
  selectedIndex,
  query,
}: {
  files: string[];
  selectedIndex: number;
  query: string;
}) {
  if (files.length === 0) {
    return (
      <Box
        borderStyle="round"
        borderColor="yellow"
        flexDirection="column"
        paddingX={1}
        marginBottom={0}
      >
        <Text color="yellow">No matching files for "{query}"</Text>
      </Box>
    );
  }

  const maxVisible = 6;
  const clampedIndex = Math.min(Math.max(0, selectedIndex), files.length - 1);
  const startIdx = Math.max(0, Math.min(clampedIndex - Math.floor(maxVisible / 2), files.length - maxVisible));
  const visibleFiles = files.slice(startIdx, startIdx + maxVisible);

  return (
    <Box
      borderStyle="round"
      borderColor="yellow"
      flexDirection="column"
      paddingX={1}
      marginBottom={0}
    >
      <Box justifyContent="space-between" marginBottom={0}>
        <Text bold color="yellow">
          📁 Files (@{query})
        </Text>
        <Text dimColor>↑↓ navigate · Tab / Enter attach</Text>
      </Box>
      {visibleFiles.map((file, i) => {
        const actualIdx = startIdx + i;
        const isSelected = actualIdx === clampedIndex;
        return (
          <Box key={file} justifyContent="space-between">
            <Text color={isSelected ? "yellowBright" : "yellow"} bold={isSelected}>
              {isSelected ? "> " : "  "}@{file}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}
