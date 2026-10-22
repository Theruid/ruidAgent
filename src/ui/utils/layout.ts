import type { PendingPermission } from "../store.js";
import type { AgentTask } from "../../tools/tasks.js";
import { getToolDiff } from "./diff.js";
import { wrapText } from "./wrap.js";
import { foldWindow } from "./lineEditor.js";

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

export type PaletteKind = "command" | "file" | null;

/**
 * Height of InputBox: optional palette above a bordered box, plus an
 * optional hint row below it. `columns` is the full terminal width.
 */
export function inputBoxRows(
  value: string,
  columns: number,
  palette: PaletteKind,
  paletteItems: number,
  opts: { cursorLine?: number; hintRow?: boolean } = {},
): number {
  // App paddingX (2) + border (2) + paddingX (2) + "> " prefix (2) + cursor (1)
  const textWidth = Math.max(10, columns - 9);
  const lines = value ? value.split("\n") : [""];
  const { start, end } = foldWindow(lines.length, opts.cursorLine ?? lines.length - 1);
  let body = lines.slice(start, end).reduce((sum, l) => sum + textRows(l || " ", textWidth), 0);
  if (end - start < lines.length) body += 1; // fold summary row
  let rows = body + 2 + (opts.hintRow ? 1 : 0);
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
  const risk = riskLabel(permission.tier);
  if (risk) header += ` · ${risk.text}`;
  if (preview && !diff && !bashCmd) header += ` (${preview})`;
  const footer = permissionFooter(permission);

  let rows = 2 + textRows(header, inner) + textRows(footer, inner);
  if (diff && diff.length > 0) {
    rows += 2 + diff.length; // diff lines render truncated, one row each
  } else if (bashCmd) {
    rows += 2 + textRows(`$ ${bashCmd}`, inner - 4);
  }
  return rows;
}

/** Plain-text footer of PermissionPrompt (its rendered form adds colour only). */
export function permissionFooter(permission: PendingPermission): string {
  const always =
    permission.tier === 4
      ? "always-allow is unavailable for sensitive actions"
      : `[a] always allow "${permission.toolName}" this session`;
  return `[y] approve · [n/Esc] reject · ${always}`;
}

/** Human label for a permission risk tier (see classifyToolRisk). */
export function riskLabel(tier: number | undefined): { text: string; color: string } | null {
  switch (tier) {
    case 0:
      return { text: "read-only", color: "green" };
    case 1:
      return { text: "edits workspace files", color: "yellow" };
    case 2:
      return { text: "read-only shell", color: "green" };
    case 3:
      return { text: "runs commands / changes state", color: "yellow" };
    case 4:
      return { text: "sensitive or destructive", color: "red" };
    default:
      return null;
  }
}

/**
 * Height of a notice: one wrapped line, or for multi-line notices a bordered
 * panel with a dismiss hint.
 */
export function noticeRows(notice: string | null, columns: number): number {
  if (!notice) return 0;
  if (!notice.includes("\n")) return textRows(notice, columns - 3);
  // App paddingX (2) + border (2) + paddingX (2)
  const inner = Math.max(10, columns - 6);
  return 2 + textRows(notice, inner) + 1;
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
