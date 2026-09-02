import React from "react";
import { Box, Text } from "ink";
import type { AgentTask } from "../../tools/tasks.js";

export function TaskPanel({ tasks }: { tasks: AgentTask[] }) {
  if (tasks.length === 0) return null;

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="blue"
      paddingX={1}
      marginBottom={1}
    >
      <Box marginBottom={0}>
        <Text bold color="blue">
          📋 Plan / Tasks ({tasks.filter((t) => t.status === "completed").length}/{tasks.length})
        </Text>
      </Box>
      {tasks.map((task) => {
        let symbol = "○";
        let color = "gray";
        if (task.status === "in_progress") {
          symbol = "⠋";
          color = "yellow";
        } else if (task.status === "completed") {
          symbol = "✓";
          color = "green";
        }

        return (
          <Box key={task.id} paddingLeft={1}>
            <Text color={color}>{symbol} </Text>
            <Text bold={task.status === "in_progress"} color={task.status === "completed" ? "gray" : undefined}>
              #{task.id} {task.subject}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}
