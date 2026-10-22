/**
 * Pure text-editing operations for the prompt input. State is the full draft
 * plus a cursor index into it; every operation returns a new state, so the
 * InputBox stays a thin key-to-operation mapping and this logic is testable.
 */
export interface EditorState {
  value: string;
  /** Index into value, 0..value.length. */
  cursor: number;
}

export const emptyEditor: EditorState = { value: "", cursor: 0 };

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

export function fromText(value: string): EditorState {
  return { value, cursor: value.length };
}

export function insert(s: EditorState, text: string): EditorState {
  return {
    value: s.value.slice(0, s.cursor) + text + s.value.slice(s.cursor),
    cursor: s.cursor + text.length,
  };
}

/** Deletes the character before the cursor (Backspace). */
export function backspace(s: EditorState): EditorState {
  if (s.cursor === 0) return s;
  const prev = previousCharStart(s.value, s.cursor);
  return { value: s.value.slice(0, prev) + s.value.slice(s.cursor), cursor: prev };
}

/** Deletes the character under the cursor (Delete). */
export function deleteForward(s: EditorState): EditorState {
  if (s.cursor >= s.value.length) return s;
  const next = nextCharEnd(s.value, s.cursor);
  return { value: s.value.slice(0, s.cursor) + s.value.slice(next), cursor: s.cursor };
}

export function left(s: EditorState): EditorState {
  return { ...s, cursor: previousCharStart(s.value, s.cursor) };
}

export function right(s: EditorState): EditorState {
  return { ...s, cursor: nextCharEnd(s.value, s.cursor) };
}

/** Start of the cursor's line (Home / Ctrl+A). */
export function lineStart(s: EditorState): EditorState {
  return { ...s, cursor: s.value.lastIndexOf("\n", s.cursor - 1) + 1 };
}

/** End of the cursor's line (End / Ctrl+E). */
export function lineEnd(s: EditorState): EditorState {
  const nl = s.value.indexOf("\n", s.cursor);
  return { ...s, cursor: nl === -1 ? s.value.length : nl };
}

const isWordChar = (c: string) => /[\p{L}\p{N}_]/u.test(c);

/** Start of the previous word (Ctrl/Alt+Left). */
export function wordLeft(s: EditorState): EditorState {
  let i = s.cursor;
  while (i > 0 && !isWordChar(s.value[i - 1])) i--;
  while (i > 0 && isWordChar(s.value[i - 1])) i--;
  return { ...s, cursor: i };
}

/** End of the next word (Ctrl/Alt+Right). */
export function wordRight(s: EditorState): EditorState {
  let i = s.cursor;
  const n = s.value.length;
  while (i < n && !isWordChar(s.value[i])) i++;
  while (i < n && isWordChar(s.value[i])) i++;
  return { ...s, cursor: i };
}

/** Deletes the word before the cursor (Ctrl+W, Ctrl+Backspace). */
export function deleteWordBack(s: EditorState): EditorState {
  const target = wordLeft(s).cursor;
  return { value: s.value.slice(0, target) + s.value.slice(s.cursor), cursor: target };
}

/** Deletes from the line start to the cursor (Ctrl+U). */
export function killToLineStart(s: EditorState): EditorState {
  const start = lineStart(s).cursor;
  // At a line start already: join with the previous line instead of doing nothing.
  if (start === s.cursor) return backspace(s);
  return { value: s.value.slice(0, start) + s.value.slice(s.cursor), cursor: start };
}

/** Deletes from the cursor to the line end (Ctrl+K). */
export function killToLineEnd(s: EditorState): EditorState {
  const end = lineEnd(s).cursor;
  if (end === s.cursor) return deleteForward(s);
  return { value: s.value.slice(0, s.cursor) + s.value.slice(end), cursor: s.cursor };
}

/** Line index and column of the cursor. */
export function cursorPosition(s: EditorState): { line: number; column: number; lineCount: number } {
  const before = s.value.slice(0, s.cursor);
  const line = before.split("\n").length - 1;
  const column = s.cursor - (before.lastIndexOf("\n") + 1);
  return { line, column, lineCount: s.value.split("\n").length };
}

/** Moves to the same column on the previous line; null when already on the first line. */
export function lineUp(s: EditorState): EditorState | null {
  const { line, column } = cursorPosition(s);
  if (line === 0) return null;
  const lines = s.value.split("\n");
  return { ...s, cursor: offsetOf(lines, line - 1, Math.min(column, lines[line - 1].length)) };
}

/** Moves to the same column on the next line; null when already on the last line. */
export function lineDown(s: EditorState): EditorState | null {
  const { line, column, lineCount } = cursorPosition(s);
  if (line >= lineCount - 1) return null;
  const lines = s.value.split("\n");
  return { ...s, cursor: offsetOf(lines, line + 1, Math.min(column, lines[line + 1].length)) };
}

function offsetOf(lines: string[], line: number, column: number): number {
  let offset = 0;
  for (let i = 0; i < line; i++) offset += lines[i].length + 1;
  return offset + column;
}

// Surrogate-pair aware single-character steps, so emoji are never split.
function previousCharStart(v: string, i: number): number {
  if (i <= 0) return 0;
  const code = v.charCodeAt(i - 1);
  if (code >= 0xdc00 && code <= 0xdfff && i >= 2) {
    const hi = v.charCodeAt(i - 2);
    if (hi >= 0xd800 && hi <= 0xdbff) return i - 2;
  }
  return i - 1;
}

function nextCharEnd(v: string, i: number): number {
  if (i >= v.length) return v.length;
  const code = v.charCodeAt(i);
  if (code >= 0xd800 && code <= 0xdbff && i + 1 < v.length) return clamp(i + 2, 0, v.length);
  return i + 1;
}

/**
 * Which lines of a long draft are on screen. Drafts longer than the fold
 * threshold show a window of `size` lines kept around the cursor, plus one
 * summary row for the hidden lines.
 */
export function foldWindow(lineCount: number, cursorLine: number, size = 4): { start: number; end: number } {
  if (lineCount <= size + 2) return { start: 0, end: lineCount };
  const start = clamp(cursorLine - Math.floor(size / 2), 0, lineCount - size);
  return { start, end: start + size };
}
