import React, { useState, useRef, useMemo, useEffect } from "react";
import { Box, Text, useInput, useStdin } from "ink";
import { CommandPalette, COMMANDS, type CommandItem } from "./CommandPalette.js";
import { FilePalette } from "./FilePalette.js";
import { listWorkspaceFiles, searchFiles } from "../utils/fileSearch.js";
import { inputBoxRows } from "../utils/layout.js";
import * as ed from "../utils/lineEditor.js";
import { truncateLine } from "../utils/wrap.js";

/**
 * Turns a raw input chunk into text to insert. Pastes arrive as one chunk;
 * their line breaks are kept (normalized to \n) while other control
 * characters are dropped.
 */
export function printableInput(input: string): string {
  const keepNewlines = input.length > 1;
  const normalized = keepNewlines ? input.replace(/\r\n?/g, "\n") : input;
  return keepNewlines
    ? normalized.replace(/[\x00-\x09\x0b-\x1f\x7f]/g, (c) => (c === "\t" ? "  " : ""))
    : normalized.replace(/[\r\n\x00-\x08\x0b-\x1f\x7f]/g, "");
}

/** How long a first Esc stays armed before a second press clears the draft. */
const ESC_CONFIRM_MS = 1500;
/** Forward-Delete's escape sequence; Ink reports it and Backspace both as `delete`. */
const FORWARD_DELETE_SEQUENCES = new Set(["\x1b[3~", "\x1b[3$", "\x1b[3^"]);

export interface InputBoxProps {
  onSubmit(line: string): void;
  disabled: boolean;
  placeholder: string;
  initialValue?: string;
  customCommands?: CommandItem[];
  /** Submitted prompts, oldest first. Owned by the caller so it outlives this component. */
  history?: string[];
  /** Terminal width, used to report the box's rendered height. */
  columns?: number;
  /** Receives the rendered height (palette included) whenever it changes. */
  onHeightChange?(rows: number): void;
  /** Told whether the draft is empty, so global keys (Esc, Home/End) know whether they belong to the input. */
  onDraftEmptyChange?(empty: boolean): void;
  /** Prompts waiting to be sent after the current turn. */
  queued?: string[];
  /** Takes the queue back for editing (Esc on an empty draft); returns its text. */
  onRestoreQueue?(): string | null;
  onCycleMode?(): void;
  onScrollUp?(): void;
  onScrollDown?(): void;
  onScrollToBottom?(): void;
}

export function InputBox({
  onSubmit,
  disabled,
  placeholder,
  initialValue,
  customCommands = [],
  history: historyProp,
  columns = 80,
  onHeightChange,
  onDraftEmptyChange,
  queued = [],
  onRestoreQueue,
  onCycleMode,
  onScrollUp,
  onScrollDown,
  onScrollToBottom,
}: InputBoxProps) {
  const [editor, setEditor] = useState<ed.EditorState>(() => ed.fromText(initialValue ?? ""));
  const [selectedCmdIdx, setSelectedCmdIdx] = useState(0);
  const [selectedFileIdx, setSelectedFileIdx] = useState(0);
  const [paletteDismissed, setPaletteDismissed] = useState(false);
  const [escArmedAt, setEscArmedAt] = useState(0);
  // The caller's array is stable (it lives on the store), so remounting after
  // a picker keeps the prompt history.
  const history = useRef<string[]>(historyProp ?? []);
  const histIdx = useRef(-1);
  const draft = useRef("");
  const value = editor.value;

  // Remember the raw sequence of the latest keypress. Registered once, so it
  // runs before useInput's handler (which re-subscribes on every render).
  const { internal_eventEmitter } = useStdin();
  const lastRaw = useRef("");
  useEffect(() => {
    const onRaw = (data: string) => {
      lastRaw.current = data;
    };
    internal_eventEmitter?.on("input", onRaw);
    return () => {
      internal_eventEmitter?.removeListener("input", onRaw);
    };
  }, [internal_eventEmitter]);

  useEffect(() => {
    if (initialValue !== undefined) {
      setEditor(ed.fromText(initialValue));
    }
  }, [initialValue]);

  useEffect(() => {
    onDraftEmptyChange?.(value.length === 0);
  }, [value.length === 0, onDraftEmptyChange]);

  // A first Esc arms "clear"; let it lapse visibly.
  useEffect(() => {
    if (!escArmedAt) return;
    const t = setTimeout(() => setEscArmedAt(0), ESC_CONFIRM_MS);
    return () => clearTimeout(t);
  }, [escArmedAt]);

  // Cached workspace files
  const workspaceFiles = useMemo(() => {
    try {
      return listWorkspaceFiles(process.cwd());
    } catch {
      return [];
    }
  }, []);

  const allCommands = useMemo(() => [...COMMANDS, ...customCommands], [customCommands]);

  // Slash command palette: the whole draft is a single "/word"
  const isSlashCmd = value.startsWith("/") && !value.includes(" ") && !value.includes("\n");
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
  const shouldShowCmdPalette = isSlashCmd && matchingCmds.length > 0 && !paletteDismissed;

  // @ file palette: an "@query" word ending at the cursor
  const beforeCursor = value.slice(0, editor.cursor);
  const atMatch = beforeCursor.match(/(?:^|\s)@([^\s]*)$/);
  const atQuery = atMatch ? atMatch[1] : null;
  const matchingFiles = atQuery !== null ? searchFiles(workspaceFiles, atQuery) : [];
  const shouldShowFilePalette = atQuery !== null && !paletteDismissed;

  const escArmed = escArmedAt > 0;
  const hintRow = escArmed || queued.length > 0;
  const { line: cursorLine } = ed.cursorPosition(editor);
  const height = inputBoxRows(
    value,
    columns,
    shouldShowCmdPalette ? "command" : shouldShowFilePalette ? "file" : null,
    shouldShowCmdPalette ? matchingCmds.length : matchingFiles.length,
    { cursorLine, hintRow },
  );
  useEffect(() => {
    onHeightChange?.(height);
  }, [height, onHeightChange]);

  /** Applies an edit and resets per-keystroke UI state. */
  const apply = (next: ed.EditorState) => {
    setEditor(next);
    setSelectedCmdIdx(0);
    setSelectedFileIdx(0);
    setEscArmedAt(0);
    if (next.value !== value) setPaletteDismissed(false);
  };

  /** Replaces the "@query" before the cursor with the chosen file. */
  const completeFile = (file: string) => {
    const replaced = beforeCursor.replace(/(?:^|\s)@([^\s]*)$/, (m) => (/^\s/.test(m) ? `${m[0]}@${file} ` : `@${file} `));
    apply({ value: replaced + value.slice(editor.cursor), cursor: replaced.length });
  };

  const recall = (text: string) => apply(ed.fromText(text));

  useInput(
    (input, key) => {
      // PageUp/PageDown, Ctrl+arrows (and Home/End on an empty draft) scroll
      // the transcript; App handles them (Ink delivers keys to every handler).
      if (key.pageUp || key.pageDown) return;
      if (key.ctrl && (key.upArrow || key.downArrow)) return;
      if ((key.home || key.end) && !value) return;

      // Tab: autocomplete slash command / file mention, or cycle modes
      if (key.tab) {
        if (shouldShowFilePalette && matchingFiles.length > 0) {
          const target = matchingFiles[Math.min(selectedFileIdx, matchingFiles.length - 1)];
          if (target) completeFile(target);
          return;
        }
        if (shouldShowCmdPalette) {
          const target = matchingCmds[Math.min(selectedCmdIdx, matchingCmds.length - 1)];
          if (target) recall(target.args ? `${target.name} ` : target.name);
          return;
        }
        if (!value.trim()) onCycleMode?.();
        return;
      }

      // Navigation inside palettes
      if (shouldShowFilePalette && matchingFiles.length > 0) {
        if (key.upArrow) {
          setSelectedFileIdx((prev) => (prev > 0 ? prev - 1 : matchingFiles.length - 1));
          return;
        }
        if (key.downArrow) {
          setSelectedFileIdx((prev) => (prev < matchingFiles.length - 1 ? prev + 1 : 0));
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
      }

      // Esc: close a palette, else clear the draft on a second press, else
      // take queued prompts back for editing.
      if (key.escape) {
        if ((shouldShowCmdPalette || shouldShowFilePalette) && !paletteDismissed) {
          setPaletteDismissed(true);
          return;
        }
        if (value) {
          if (escArmed) {
            apply(ed.emptyEditor);
            histIdx.current = -1;
          } else {
            setEscArmedAt(Date.now());
          }
          return;
        }
        const restored = onRestoreQueue?.();
        if (restored) recall(restored);
        return;
      }

      // Enter / newline (Shift/Alt/Ctrl+Enter, Ctrl+J, or a trailing backslash)
      const isReturnKey =
        key.return ||
        input === "\n" ||
        input === "\r" ||
        input === "\r\n" ||
        (key.ctrl && (input === "j" || input === "\n"));

      if (isReturnKey) {
        const backslashBefore = beforeCursor.endsWith("\\");
        const isMultiLine = key.shift || key.meta || key.ctrl || input === "\n" || backslashBefore;
        if (isMultiLine) {
          apply(ed.insert(backslashBefore ? ed.backspace(editor) : editor, "\n"));
          return;
        }

        if (shouldShowFilePalette && matchingFiles.length > 0) {
          const target = matchingFiles[Math.min(selectedFileIdx, matchingFiles.length - 1)];
          if (target) {
            completeFile(target);
            return;
          }
        }

        if (shouldShowCmdPalette && !matchingCmds.some((c) => c.name === value.trim())) {
          const target = matchingCmds[Math.min(selectedCmdIdx, matchingCmds.length - 1)];
          if (target && !target.args) {
            apply(ed.emptyEditor);
            onSubmit(target.name);
            onScrollToBottom?.();
            return;
          } else if (target && target.args) {
            recall(`${target.name} `);
            return;
          }
        }

        const line = value.trim();
        if (!line) return;
        if (history.current.at(-1) !== line) history.current.push(line);
        histIdx.current = -1;
        apply(ed.emptyEditor);
        onSubmit(line);
        onScrollToBottom?.();
        return;
      }

      // Up/Down: move between lines of a multi-line draft, then history, then scroll
      if (key.upArrow) {
        const moved = ed.lineUp(editor);
        if (moved) {
          setEditor(moved);
          return;
        }
        if (history.current.length > 0 && (value !== "" || histIdx.current !== -1)) {
          if (histIdx.current === -1) {
            draft.current = value;
            histIdx.current = history.current.length - 1;
          } else if (histIdx.current > 0) {
            histIdx.current -= 1;
          }
          recall(history.current[histIdx.current]);
          return;
        }
        if (value === "") onScrollUp?.();
        return;
      }
      if (key.downArrow) {
        const moved = ed.lineDown(editor);
        if (moved) {
          setEditor(moved);
          return;
        }
        if (histIdx.current !== -1) {
          histIdx.current += 1;
          if (histIdx.current >= history.current.length) {
            histIdx.current = -1;
            recall(draft.current);
          } else {
            recall(history.current[histIdx.current]);
          }
          return;
        }
        if (value === "") onScrollDown?.();
        return;
      }

      // Cursor movement
      const wordMod = key.ctrl || key.meta;
      if (key.leftArrow) return setEditor(wordMod ? ed.wordLeft(editor) : ed.left(editor));
      if (key.rightArrow) return setEditor(wordMod ? ed.wordRight(editor) : ed.right(editor));
      if (key.home) return setEditor(ed.lineStart(editor));
      if (key.end) return setEditor(ed.lineEnd(editor));

      // Deletion. Ink names Backspace "delete" on most terminals, so the raw
      // sequence tells forward-Delete apart.
      if (key.backspace || key.delete) {
        if (key.delete && FORWARD_DELETE_SEQUENCES.has(lastRaw.current)) {
          apply(ed.deleteForward(editor));
        } else {
          apply(key.meta || key.ctrl ? ed.deleteWordBack(editor) : ed.backspace(editor));
        }
        return;
      }

      // Emacs-style editing keys
      if (key.ctrl) {
        switch (input) {
          case "a":
            return setEditor(ed.lineStart(editor));
          case "e":
            return setEditor(ed.lineEnd(editor));
          case "w":
            return apply(ed.deleteWordBack(editor));
          case "u":
            return apply(ed.killToLineStart(editor));
          case "k":
            return apply(ed.killToLineEnd(editor));
          case "b":
            return setEditor(ed.left(editor));
          case "f":
            return setEditor(ed.right(editor));
        }
        return;
      }
      if (key.meta) {
        if (input === "b") return setEditor(ed.wordLeft(editor));
        if (input === "f") return setEditor(ed.wordRight(editor));
        return;
      }

      const printable = printableInput(input);
      if (!printable) return;
      if (histIdx.current !== -1) histIdx.current = -1;
      onScrollToBottom?.();
      apply(ed.insert(editor, printable));
    },
    { isActive: !disabled },
  );

  const lines = value ? value.split("\n") : [];
  const { start, end } = ed.foldWindow(lines.length, cursorLine);
  const hiddenAbove = start;
  const hiddenBelow = lines.length - end;
  const cursorCol = editor.cursor - (beforeCursor.lastIndexOf("\n") + 1);
  const showCursor = !disabled;

  return (
    <Box flexDirection="column">
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
        borderColor={shouldShowCmdPalette ? "cyan" : shouldShowFilePalette ? "yellow" : escArmed ? "red" : undefined}
      >
        {lines.length === 0 ? (
          <Box>
            <Text dimColor>{"> "}</Text>
            {showCursor && <Text inverse> </Text>}
            <Text dimColor>{showCursor ? " " : ""}{placeholder}</Text>
          </Box>
        ) : (
          <>
            {lines.slice(start, end).map((line, i) => {
              const idx = start + i;
              const prefix = idx === 0 ? "> " : "… ";
              if (idx !== cursorLine || !showCursor) {
                return (
                  <Box key={idx}>
                    <Text dimColor>{prefix}</Text>
                    <Text wrap="wrap">{line || " "}</Text>
                  </Box>
                );
              }
              const chars = Array.from(line);
              const col = Array.from(line.slice(0, cursorCol)).length;
              return (
                <Box key={idx}>
                  <Text dimColor>{prefix}</Text>
                  <Text wrap="wrap">
                    {chars.slice(0, col).join("")}
                    <Text inverse>{chars[col] ?? " "}</Text>
                    {chars.slice(col + 1).join("")}
                  </Text>
                </Box>
              );
            })}
            {(hiddenAbove > 0 || hiddenBelow > 0) && (
              <Box key="fold-pill">
                <Text color="cyan">
                  {"  "}… {[hiddenAbove > 0 ? `${hiddenAbove} above` : "", hiddenBelow > 0 ? `${hiddenBelow} below` : ""]
                    .filter(Boolean)
                    .join(" · ")}{" "}
                  · {lines.length} lines · ↑↓ move · Enter send
                </Text>
              </Box>
            )}
          </>
        )}
      </Box>
      {hintRow && (
        <Box paddingLeft={1}>
          {escArmed ? (
            <Text color="red">Press Esc again to clear the draft</Text>
          ) : (
            <Text color="yellow">
              {truncateLine(
                `⏳ ${queued.length} queued: ${queued[0].replace(/\s+/g, " ")}${queued.length > 1 ? ` (+${queued.length - 1})` : ""} · Esc on empty input to edit`,
                Math.max(20, columns - 4),
              )}
            </Text>
          )}
        </Box>
      )}
    </Box>
  );
}
