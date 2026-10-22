import React from "react";
import { Box, Text } from "ink";
import type { AgentTask } from "../../tools/tasks.js";
import { taskWindow } from "../utils/layout.js";

export function TaskPanel({ tasks }: { tasks: AgentTask[] }) {
  if (tasks.length === 0) return null;

  const total = tasks.length;
  const completedCount = tasks.filter((t) => t.status === "completed").length;
  const allDone = total > 0 && completedCount === total;

  if (allDone) {
    return (
      <Box
        borderStyle="round"
        borderColor="green"
        paddingX={1}
        marginBottom={1}
        justifyContent="space-between"
      >
        <Text color="green" bold>
          ✓ All tasks completed ({total}/{total})
        </Text>
        <Text dimColor>Plan finished</Text>
      </Box>
    );
  }

  const { visible: visibleTasks, hiddenAbove, hiddenBelow } = taskWindow(tasks);

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
          📋 Plan / Tasks ({completedCount}/{total})
        </Text>
      </Box>

      {hiddenAbove > 0 && (
        <Box paddingLeft={1}>
          <Text color="gray" italic>
            ▲ {hiddenAbove} earlier {hiddenAbove === 1 ? "task" : "tasks"}...
          </Text>
        </Box>
      )}

      {visibleTasks.map((task) => {
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
            <Text bold={task.status === "in_progress"} color={task.status === "completed" ? "gray" : undefined} wrap="truncate">
              #{task.id} {task.subject}
            </Text>
          </Box>
        );
      })}

      {hiddenBelow > 0 && (
        <Box paddingLeft={1}>
          <Text color="gray" italic>
            ▼ {hiddenBelow} more {hiddenBelow === 1 ? "task" : "tasks"}...
          </Text>
        </Box>
      )}
    </Box>
  );
}
