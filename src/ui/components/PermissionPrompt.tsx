import React from "react";
import { Box, Text } from "ink";
import type { AgentUIStore, PendingPermission } from "../store.js";
import { getToolDiff, type DiffLine } from "../utils/diff.js";
import { highlightCodeLine } from "../utils/syntax.js";

export function PermissionPrompt({
  permission,
  store,
}: {
  permission: PendingPermission;
  store: AgentUIStore;
}) {
  const diff = getToolDiff(permission.toolName, permission.input);
  const isBash = permission.toolName === "bash";
  const bashCmd =
    isBash && permission.input && typeof permission.input === "object"
      ? String((permission.input as Record<string, unknown>).command || "")
      : null;

  const preview = permission.argsPreview
    ? permission.argsPreview.length > 80
      ? permission.argsPreview.slice(0, 80) + "…"
      : permission.argsPreview
    : null;

  return (
    <Box borderStyle="round" paddingX={1} borderColor="yellow" flexDirection="column">
      <Box justifyContent="space-between">
        <Box>
          <Text color="yellow" bold>
            Action requires permission:{" "}
          </Text>
          <Text color="yellowBright" bold>
            {permission.toolName}
          </Text>
          {preview && !diff && !bashCmd && (
            <Text dimColor> ({preview})</Text>
          )}
        </Box>
      </Box>

      {/* Visual Diff for edit_file / write_file */}
      {diff && diff.length > 0 && (
        <Box
          borderStyle="single"
          borderColor="gray"
          flexDirection="column"
          paddingX={1}
          marginY={0}
        >
          {diff.map((line, i) => {
            if (line.type === "header") {
              return (
                <Text key={i} dimColor>
                  {line.text}
                </Text>
              );
            }
            if (line.type === "del") {
              return (
                <Text key={i} color="red">
                  {line.text}
                </Text>
              );
            }
            if (line.type === "add") {
              return (
                <Text key={i} color="green">
                  {line.text}
                </Text>
              );
            }
            if (line.type === "hunk") {
              return (
                <Text key={i} color="cyan">
                  {line.text}
                </Text>
              );
            }
            return (
              <Text key={i} dimColor>
                {line.text}
              </Text>
            );
          })}
        </Box>
      )}

      {/* Syntax-highlighted command for bash */}
      {bashCmd && (
        <Box
          borderStyle="single"
          borderColor="gray"
          flexDirection="column"
          paddingX={1}
          marginY={0}
        >
          <Text>
            <Text color="cyan">$ </Text>
            {highlightCodeLine(bashCmd, "bash")}
          </Text>
        </Box>
      )}

      <Box marginTop={0}>
        <Text color="cyan">[y]</Text>
        <Text> approve · </Text>
        <Text color="red">[n]</Text>
        <Text> reject · </Text>
        <Text color="magenta">[a]</Text>
        <Text> always allow "{permission.toolName}" this session</Text>
      </Box>
    </Box>
  );
}
