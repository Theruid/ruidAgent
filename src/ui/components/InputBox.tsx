import React, { useState, useRef, useMemo, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import { CommandPalette, COMMANDS } from "./CommandPalette.js";
import { FilePalette } from "./FilePalette.js";
import { listWorkspaceFiles, searchFiles } from "../utils/fileSearch.js";

export interface InputBoxProps {
  onSubmit(line: string): void;
  disabled: boolean;
  placeholder: string;
  initialValue?: string;
  onCycleMode?(): void;
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
  initialValue,
  onCycleMode,
  onScrollUp,
  onScrollDown,
  onScrollPageUp,
  onScrollPageDown,
  onScrollToBottom,
}: InputBoxProps) {
  const [value, setValue] = useState(initialValue ?? "");
  const [selectedCmdIdx, setSelectedCmdIdx] = useState(0);
  const [selectedFileIdx, setSelectedFileIdx] = useState(0);
  const [showPalette, setShowPalette] = useState(false);
  const history = useRef<string[]>([]);
  const histIdx = useRef(-1);
  const draft = useRef("");

  useEffect(() => {
    if (initialValue !== undefined) {
      setValue(initialValue);
    }
  }, [initialValue]);

  // Cached workspace files
  const workspaceFiles = useMemo(() => {
    try {
      return listWorkspaceFiles(process.cwd());
    } catch {
      return [];
    }
  }, []);

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

  const shouldShowCmdPalette = isSlashCmd && matchingCmds.length > 0 && !showPalette;

  // Determine if @ file palette should be shown
  // Matches '@query' at end of text or preceded by space
  const atMatch = value.match(/(?:^|\s)@([^\s]*)$/);
  const atQuery = atMatch ? atMatch[1] : null;
  const matchingFiles = atQuery !== null ? searchFiles(workspaceFiles, atQuery) : [];
  const shouldShowFilePalette = atQuery !== null && !showPalette;

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

      // 2. Tab key: autocomplete slash command, file mention, OR cycle modes
      if (key.tab) {
        if (shouldShowFilePalette && matchingFiles.length > 0) {
          const target = matchingFiles[Math.min(selectedFileIdx, matchingFiles.length - 1)];
          if (target) {
            const updated = value.replace(/(?:^|\s)@([^\s]*)$/, (m) => m.startsWith(" ") ? ` @${target} ` : `@${target} `);
            setValue(updated);
            setSelectedFileIdx(0);
          }
          return;
        }

        if (shouldShowCmdPalette) {
          const target = matchingCmds[Math.min(selectedCmdIdx, matchingCmds.length - 1)];
          if (target) {
            const completed = target.args ? `${target.name} ` : target.name;
            setValue(completed);
            setSelectedCmdIdx(0);
          }
          return;
        }

        // Empty input or non-slash command: cycle through modes!
        if (!value.trim()) {
          onCycleMode?.();
          return;
        }
      }

      // 3. Navigation inside palettes (File or Command)
      if (shouldShowFilePalette && matchingFiles.length > 0) {
        if (key.upArrow) {
          setSelectedFileIdx((prev) => (prev > 0 ? prev - 1 : matchingFiles.length - 1));
          return;
        }
        if (key.downArrow) {
          setSelectedFileIdx((prev) => (prev < matchingFiles.length - 1 ? prev + 1 : 0));
          return;
        }
        if (key.escape) {
          setShowPalette(true);
          return;
        }
      } else if (shouldShowCmdPalette) {
        if (key.upArrow) {
          setSelectedCmdIdx((prev) => (prev > 0 ? prev - 1 : matchingCmds.length - 1));
          return;
        }
        if (key.downArrow) {
          setSelectedCmdIdx((prev) => (prev < matchingCmds.length - 1 ? prev + 1 : 0));
          return;
        }
        if (key.escape) {
          setShowPalette(true);
          return;
        }
      }

      // 4. Enter / Shift+Enter / Alt+Enter / Ctrl+Enter key
      if (key.return) {
        // Multi-line trigger: Shift+Enter, Alt+Enter, Ctrl+Enter, or trailing backslash \
        const isMultiLine =
          key.shift ||
          key.meta ||
          key.ctrl ||
          input === "\n" ||
          input === "\r\n" ||
          value.endsWith("\\");

        if (isMultiLine) {
          // If ended with \, strip the backslash and add newline
          const nextVal = value.endsWith("\\") ? value.slice(0, -1) + "\n" : value + "\n";
          setValue(nextVal);
          return;
        }

        // Selecting file from palette on Enter
        if (shouldShowFilePalette && matchingFiles.length > 0) {
          const target = matchingFiles[Math.min(selectedFileIdx, matchingFiles.length - 1)];
          if (target) {
            const updated = value.replace(/(?:^|\s)@([^\s]*)$/, (m) => m.startsWith(" ") ? ` @${target} ` : `@${target} `);
            setValue(updated);
            setSelectedFileIdx(0);
            return;
          }
        }

        // Selecting slash command from palette on Enter
        if (shouldShowCmdPalette && !matchingCmds.some((c) => c.name === value.trim())) {
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

        const line = value.trim();
        if (!line) return;
        history.current.push(line);
        histIdx.current = -1;
        setValue("");
        setSelectedCmdIdx(0);
        setSelectedFileIdx(0);
        setShowPalette(false);
        onSubmit(line);
        onScrollToBottom?.();
        return;
      }

      // 5. Up/Down Arrow handling when NOT in palette
      if (key.upArrow) {
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

        if (value === "") {
          onScrollDown?.();
          return;
        }
      }

      // 6. Backspace / Delete
      if (key.backspace || key.delete) {
        setValue((v) => {
          const next = v.slice(0, -1);
          if (!next.startsWith("/") && !next.includes("@")) setShowPalette(false);
          return next;
        });
        setSelectedCmdIdx(0);
        setSelectedFileIdx(0);
        return;
      }

      // 7. Escape
      if (key.escape) {
        if (value) {
          setValue("");
          setShowPalette(false);
          setSelectedCmdIdx(0);
          setSelectedFileIdx(0);
        }
        return;
      }

      if (key.ctrl) return;

      // Text entry
      onScrollToBottom?.();
      setValue((v) => {
        const next = v + input.replace(/\r/g, "");
        if (next.startsWith("/") || next.includes("@")) setShowPalette(false);
        return next;
      });
      setSelectedCmdIdx(0);
      setSelectedFileIdx(0);
    },
    { isActive: !disabled },
  );

  return (
    <Box flexDirection="column" marginTop={disabled ? 0 : undefined}>
      {shouldShowCmdPalette && (
        <CommandPalette query={value} selectedIndex={selectedCmdIdx} />
      )}
      {shouldShowFilePalette && (
        <FilePalette query={atQuery || ""} files={matchingFiles} selectedIndex={selectedFileIdx} />
      )}
      <Box
        borderStyle="round"
        paddingX={1}
        borderColor={shouldShowCmdPalette ? "cyan" : shouldShowFilePalette ? "yellow" : undefined}
      >
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
