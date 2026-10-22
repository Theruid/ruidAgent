import type { PendingPermission } from "../store.js";
import type { AgentTask } from "../../tools/tasks.js";
import { getToolDiff } from "./diff.js";
import { wrapText } from "./wrap.js";

/**
 * Row heights of the panels stacked under the transcript. App subtracts them
 * from the terminal height to size the message viewport, so each must match
 * what its component actually renders — an underestimate pushes the status
 * bar off screen.
 */

/** Terminal rows a block of text takes when wrapped to `width`. */
export function textRows(text: string, width: number): number {
  return wrapText(text, width).length;
}

export const MAX_PALETTE_ROWS = 6;
/** Input lines shown before the draft folds into first two + pill + last. */
export const INPUT_FOLD_THRESHOLD = 6;

export type PaletteKind = "command" | "file" | null;

/**
 * Height of InputBox: optional palette above a bordered box.
 * `columns` is the full terminal width.
 */
export function inputBoxRows(value: string, columns: number, palette: PaletteKind, paletteItems: number): number {
  // App paddingX (2) + border (2) + paddingX (2) + "> " prefix (2) + cursor (1)
  const textWidth = Math.max(10, columns - 9);
  const lines = value ? value.split("\n") : [""];
  let body: number;
  if (lines.length > INPUT_FOLD_THRESHOLD) {
    body = textRows(lines[0], textWidth) + textRows(lines[1], textWidth) + 1 + textRows(lines[lines.length - 1], textWidth);
  } else {
    body = lines.reduce((sum, l) => sum + textRows(l || " ", textWidth), 0);
  }
  let rows = body + 2;
  if (palette === "command" && paletteItems > 0) rows += 3 + Math.min(MAX_PALETTE_ROWS, paletteItems);
  if (palette === "file") rows += paletteItems === 0 ? 3 : 3 + Math.min(MAX_PALETTE_ROWS, paletteItems);
  return rows;
}

/** Height of PermissionPrompt for this request. */
export function permissionPromptRows(permission: PendingPermission, columns: number): number {
  // App paddingX (2) + border (2) + paddingX (2)
  const inner = Math.max(10, columns - 6);
  const diff = getToolDiff(permission.toolName, permission.input);
  const isBash = permission.toolName === "bash";
  const bashCmd =
    isBash && permission.input && typeof permission.input === "object"
      ? String((permission.input as Record<string, unknown>).command || "")
      : null;
  const preview = permissionPreview(permission);

  let header = `Action requires permission: ${permission.toolName}`;
  if (preview && !diff && !bashCmd) header += ` (${preview})`;
  const footer = `[y] approve · [n] reject · [a] always allow "${permission.toolName}" this session`;

  let rows = 2 + textRows(header, inner) + textRows(footer, inner);
  if (diff && diff.length > 0) {
    rows += 2 + diff.length; // diff lines render truncated, one row each
  } else if (bashCmd) {
    rows += 2 + textRows(`$ ${bashCmd}`, inner - 4);
  }
  return rows;
}

/** The argument preview PermissionPrompt shows next to the tool name. */
export function permissionPreview(permission: PendingPermission): string | null {
  if (!permission.argsPreview) return null;
  return permission.argsPreview.length > 80 ? permission.argsPreview.slice(0, 80) + "…" : permission.argsPreview;
}

export const MAX_VISIBLE_TASKS = 5;

/** Which tasks TaskPanel shows: a window around the active one. */
export function taskWindow(tasks: AgentTask[]): { visible: AgentTask[]; hiddenAbove: number; hiddenBelow: number } {
  const total = tasks.length;
  if (total <= MAX_VISIBLE_TASKS) return { visible: tasks, hiddenAbove: 0, hiddenBelow: 0 };
  const activeIdx = tasks.findIndex((t) => t.status === "in_progress");
  const targetIdx = activeIdx !== -1 ? activeIdx : tasks.findIndex((t) => t.status === "pending");
  const focusIdx = targetIdx !== -1 ? targetIdx : total - 1;
  const start = Math.max(0, Math.min(focusIdx - Math.floor(MAX_VISIBLE_TASKS / 2), total - MAX_VISIBLE_TASKS));
  const visible = tasks.slice(start, start + MAX_VISIBLE_TASKS);
  return { visible, hiddenAbove: start, hiddenBelow: total - (start + visible.length) };
}

/** Height of TaskPanel, including its bottom margin. */
export function taskPanelRows(tasks: AgentTask[]): number {
  if (tasks.length === 0) return 0;
  // border (2) + bottom margin (1)
  if (tasks.every((t) => t.status === "completed")) return 2 + 1 + 1;
  const { visible, hiddenAbove, hiddenBelow } = taskWindow(tasks);
  return 2 + 1 + 1 + visible.length + (hiddenAbove > 0 ? 1 : 0) + (hiddenBelow > 0 ? 1 : 0);
}

/** Height of UpdatePrompt: border (2) + two lines + bottom margin (1). */
export const UPDATE_PROMPT_ROWS = 5;
