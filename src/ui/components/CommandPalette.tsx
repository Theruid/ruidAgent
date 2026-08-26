import React from "react";
import { Box, Text } from "ink";

export interface CommandItem {
  name: string;
  args?: string;
  description: string;
}

export const COMMANDS: CommandItem[] = [
  { name: "/mode", args: "<code|plan|auto>", description: "Switch mode or show current (Tab cycles)" },
  { name: "/tasks", description: "Show active plan and tasks" },
  { name: "/rollback", args: "[turn]", description: "Revert file modifications made during turn" },
  { name: "/new", description: "Start a new chat session" },
  { name: "/resume", description: "Pick and resume a saved session" },
  { name: "/sessions", description: "List all saved sessions" },
  { name: "/setup", description: "Interactive LLM provider setup wizard" },
  { name: "/providers", description: "Browse, search & switch configured providers" },
  { name: "/connect", args: "[name]", description: "Switch provider (interactive picker if no name)" },
  { name: "/model", args: "[id]", description: "Browse, search & switch models interactively" },
  { name: "/clear", description: "Clear current conversation history" },
  { name: "/help", description: "Show available commands" },
  { name: "/exit", description: "Exit ruid" },
];

export function CommandPalette({
  query,
  selectedIndex,
}: {
  query: string;
  selectedIndex: number;
}) {
  const filtered = COMMANDS.filter((cmd) => {
    const q = query.toLowerCase().trim();
    if (!q || q === "/") return true;
    return cmd.name.toLowerCase().startsWith(q) || cmd.name.slice(1).toLowerCase().startsWith(q.replace(/^\//, ""));
  });

  if (filtered.length === 0) {
    return null;
  }

  // Show up to 6 suggestions
  const maxVisible = 6;
  const clampedIndex = Math.min(Math.max(0, selectedIndex), filtered.length - 1);
  const startIdx = Math.max(0, Math.min(clampedIndex - Math.floor(maxVisible / 2), filtered.length - maxVisible));
  const visibleCommands = filtered.slice(startIdx, startIdx + maxVisible);

  return (
    <Box
      borderStyle="round"
      borderColor="cyan"
      flexDirection="column"
      paddingX={1}
      marginBottom={0}
    >
      <Box justifyContent="space-between" marginBottom={0}>
        <Text bold color="cyan">
          Commands
        </Text>
        <Text dimColor>↑↓ select · Tab complete · Enter run · Esc cancel</Text>
      </Box>
      {visibleCommands.map((cmd, i) => {
        const actualIdx = startIdx + i;
        const isSelected = actualIdx === clampedIndex;
        return (
          <Box key={cmd.name} justifyContent="space-between">
            <Box>
              <Text color={isSelected ? "cyanBright" : "cyan"} bold={isSelected}>
                {isSelected ? "> " : "  "}
                {cmd.name}
              </Text>
              {cmd.args && <Text dimColor> {cmd.args}</Text>}
            </Box>
            <Text dimColor={!isSelected} color={isSelected ? "white" : undefined}>
              {cmd.description}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}
