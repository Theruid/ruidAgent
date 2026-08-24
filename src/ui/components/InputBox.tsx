import React, { useState, useRef } from "react";
import { Box, Text, useInput } from "ink";
import { CommandPalette, COMMANDS } from "./CommandPalette.js";

export interface InputBoxProps {
  onSubmit(line: string): void;
  disabled: boolean;
  placeholder: string;
  onScrollUp?(): void;
  onScrollDown?(): void;
  onScrollPageUp?(): void;
  onScrollPageDown?(): void;
  onScrollToBottom?(): void;
}

export function InputBox({
  onSubmit,
  disabled,
  placeholder,
  onScrollUp,
  onScrollDown,
  onScrollPageUp,
  onScrollPageDown,
  onScrollToBottom,
}: InputBoxProps) {
  const [value, setValue] = useState("");
  const [selectedCmdIdx, setSelectedCmdIdx] = useState(0);
  const [showPalette, setShowPalette] = useState(false);
  const history = useRef<string[]>([]);
  const histIdx = useRef(-1);
  const draft = useRef("");

  // Determine if slash command palette should be shown
  const isSlashCmd = value.startsWith("/") && !value.includes(" ");
  const matchingCmds = isSlashCmd
    ? COMMANDS.filter((cmd) => {
        const q = value.toLowerCase();
        return (
          q === "/" ||
          cmd.name.toLowerCase().startsWith(q) ||
          cmd.name.slice(1).toLowerCase().startsWith(q.slice(1))
        );
      })
    : [];

  const shouldShowPalette = isSlashCmd && matchingCmds.length > 0 && !showPalette;

  useInput(
    (input, key) => {
      // 1. PageUp / PageDown for scrolling chat
      if (key.pageUp) {
        onScrollPageUp?.();
        return;
      }
      if (key.pageDown) {
        onScrollPageDown?.();
        return;
      }

      // 2. Autocomplete navigation when typing slash commands
      if (isSlashCmd && matchingCmds.length > 0 && !showPalette) {
        if (key.tab) {
          const target = matchingCmds[Math.min(selectedCmdIdx, matchingCmds.length - 1)];
          if (target) {
            const completed = target.args ? `${target.name} ` : target.name;
            setValue(completed);
            setSelectedCmdIdx(0);
          }
          return;
        }

        if (key.upArrow) {
          setSelectedCmdIdx((prev) => (prev > 0 ? prev - 1 : matchingCmds.length - 1));
          return;
        }

        if (key.downArrow) {
          setSelectedCmdIdx((prev) => (prev < matchingCmds.length - 1 ? prev + 1 : 0));
          return;
        }

        if (key.escape) {
          setShowPalette(true); // temporarily dismiss palette for this input
          return;
        }
      }

      // 3. Enter key
      if (key.return) {
        // If user is selecting a command from palette and presses Enter on a match without args
        if (isSlashCmd && matchingCmds.length > 0 && !showPalette && !matchingCmds.some(c => c.name === value.trim())) {
          const target = matchingCmds[Math.min(selectedCmdIdx, matchingCmds.length - 1)];
          if (target && !target.args) {
            const cmdName = target.name;
            setValue("");
            setSelectedCmdIdx(0);
            onSubmit(cmdName);
            onScrollToBottom?.();
            return;
          } else if (target && target.args) {
            setValue(`${target.name} `);
            setSelectedCmdIdx(0);
            return;
          }
        }

        const line = value.replace(/\n/g, " ").trim();
        if (!line) return;
        history.current.push(line);
        histIdx.current = -1;
        setValue("");
        setSelectedCmdIdx(0);
        setShowPalette(false);
        onSubmit(line);
        onScrollToBottom?.();
        return;
      }

      // 4. Up/Down Arrow handling when NOT in autocomplete
      if (key.upArrow) {
        // If input has text or history exists and user has started navigating history
        if (value !== "" || (history.current.length > 0 && histIdx.current !== -1)) {
          if (history.current.length === 0) return;
          if (histIdx.current === -1) {
            draft.current = value;
            histIdx.current = history.current.length - 1;
          } else if (histIdx.current > 0) {
            histIdx.current -= 1;
          }
          setValue(history.current[histIdx.current]);
          return;
        }

        // When input is completely empty, Up arrow scrolls chat history!
        if (value === "") {
          onScrollUp?.();
          return;
        }
      }

      if (key.downArrow) {
        if (histIdx.current !== -1) {
          histIdx.current += 1;
          if (histIdx.current >= history.current.length) {
            histIdx.current = -1;
            setValue(draft.current);
          } else {
            setValue(history.current[histIdx.current]);
          }
          return;
        }

        // When input is empty, Down arrow scrolls chat down
        if (value === "") {
          onScrollDown?.();
          return;
        }
      }

      // 5. Backspace / Delete
      if (key.backspace || key.delete) {
        setValue((v) => {
          const next = v.slice(0, -1);
          if (!next.startsWith("/")) setShowPalette(false);
          return next;
        });
        setSelectedCmdIdx(0);
        return;
      }

      // 6. Escape
      if (key.escape) {
        if (value) {
          setValue("");
          setShowPalette(false);
          setSelectedCmdIdx(0);
        }
        return;
      }

      if (key.ctrl) return;

      // Text entry
      onScrollToBottom?.();
      setValue((v) => {
        const next = v + input.replace(/\r?\n/g, " ");
        if (next.startsWith("/")) setShowPalette(false);
        return next;
      });
      setSelectedCmdIdx(0);
    },
    { isActive: !disabled },
  );

  return (
    <Box flexDirection="column" marginTop={disabled ? 0 : undefined}>
      {shouldShowPalette && (
        <CommandPalette query={value} selectedIndex={selectedCmdIdx} />
      )}
      <Box borderStyle="round" paddingX={1} borderColor={shouldShowPalette ? "cyan" : undefined}>
        <Text dimColor>{"> "} </Text>
        {value ? (
          <Text wrap="wrap">{value}</Text>
        ) : (
          <Text dimColor>{placeholder}</Text>
        )}
        {value && <Text dimColor>▌</Text>}
      </Box>
    </Box>
  );
}
