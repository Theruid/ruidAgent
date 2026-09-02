import React, { useState, useRef, useMemo, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import { CommandPalette, COMMANDS, type CommandItem } from "./CommandPalette.js";
import { FilePalette } from "./FilePalette.js";
import { listWorkspaceFiles, searchFiles } from "../utils/fileSearch.js";

export interface InputBoxProps {
  onSubmit(line: string): void;
  disabled: boolean;
  placeholder: string;
  initialValue?: string;
  customCommands?: CommandItem[];
  onPaletteChange?(isOpen: boolean): void;
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
  customCommands = [],
  onPaletteChange,
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

  const allCommands = useMemo(() => [...COMMANDS, ...customCommands], [customCommands]);

  // Determine if slash command palette should be shown
  const isSlashCmd = value.startsWith("/") && !value.includes(" ");
  const matchingCmds = isSlashCmd
    ? allCommands.filter((cmd) => {
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

  const isPaletteOpen = shouldShowCmdPalette || shouldShowFilePalette;
  useEffect(() => {
    onPaletteChange?.(isPaletteOpen);
  }, [isPaletteOpen, onPaletteChange]);

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

      // 4. Enter / Newline key handling (Enter, Ctrl+Enter, Shift+Enter, Alt+Enter, Ctrl+J)
      const isReturnKey =
        key.return ||
        input === "\n" ||
        input === "\r" ||
        input === "\r\n" ||
        input === "\x0a" ||
        (key.ctrl && (input === "j" || input === "\n"));

      if (isReturnKey) {
        // Multi-line newline trigger
        const isMultiLine =
          key.shift ||
          key.meta ||
          key.ctrl ||
          input === "\n" ||
          input === "\x0a" ||
          (key.ctrl && input === "j") ||
          value.endsWith("\\");

        if (isMultiLine) {
          // If ended with \, strip the backslash and add a single newline
          setValue((v) => (v.endsWith("\\") ? v.slice(0, -1) + "\n" : v + "\n"));
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

      // Ignore other control/escape codes
      if (key.ctrl || key.meta) return;

      // Filter out raw newlines/carriage returns here since key.return handles them above
      const printable = input.replace(/[\r\n\x00-\x08\x0b-\x1f\x7f]/g, "");
      if (!printable) return;

      // Regular text entry
      onScrollToBottom?.();
      setValue((v) => {
        const next = v + printable;
        if (next.startsWith("/") || next.includes("@")) setShowPalette(false);
        return next;
      });
      setSelectedCmdIdx(0);
      setSelectedFileIdx(0);
    },
    { isActive: !disabled },
  );

  const lines = value ? value.split("\n") : [];
  const isFolded = lines.length > 6;
  const foldedHidden = isFolded ? lines.length - 3 : 0;

  // When folded, show first 2 lines, a fold pill, and last line
  const displayLines = isFolded
    ? [...lines.slice(0, 2), null, lines[lines.length - 1]]
    : lines;

  return (
    <Box flexDirection="column" marginTop={disabled ? 0 : undefined}>
      {shouldShowCmdPalette && (
        <CommandPalette query={value} selectedIndex={selectedCmdIdx} customCommands={customCommands} />
      )}
      {shouldShowFilePalette && (
        <FilePalette query={atQuery || ""} files={matchingFiles} selectedIndex={selectedFileIdx} />
      )}
      <Box
        borderStyle="round"
        paddingX={1}
        flexDirection="column"
        borderColor={shouldShowCmdPalette ? "cyan" : shouldShowFilePalette ? "yellow" : undefined}
      >
        {displayLines.length === 0 ? (
          <Box>
            <Text dimColor>{"> "} </Text>
            <Text dimColor>{placeholder}</Text>
          </Box>
        ) : (
          displayLines.map((line, idx) => {
            // Fold pill
            if (line === null) {
              return (
                <Box key="fold-pill">
                  <Text dimColor>  </Text>
                  <Text color="cyan">… [{foldedHidden} lines hidden · Enter to send · Esc to clear] …</Text>
                </Box>
              );
            }

            const isLast = idx === displayLines.length - 1;
            const prefix = idx === 0 ? "> " : "… ";
            return (
              <Box key={idx}>
                <Text dimColor>{prefix}</Text>
                <Text wrap="wrap">{line || " "}</Text>
                {isLast && <Text dimColor>▌</Text>}
              </Box>
            );
          })
        )}
      </Box>
    </Box>
  );
}
