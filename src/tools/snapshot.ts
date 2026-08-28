import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { Workspace } from "./fs.js";

export interface FileSnapshot {
  relPath: string;
  exists: boolean;
  content: string | null;
}

export interface TurnSnapshot {
  turn: number;
  timestamp: number;
  files: Map<string, FileSnapshot>;
  sideEffects: string[];
}

export class SnapshotManager {
  private history: TurnSnapshot[] = [];
  private currentTurn: TurnSnapshot | null = null;
  private turnCounter = 1;

  beginTurn(): void {
    this.currentTurn = {
      turn: this.turnCounter++,
      timestamp: Date.now(),
      files: new Map(),
      sideEffects: [],
    };
    this.history.push(this.currentTurn);
  }

  /**
   * Records an unrevertable side-effecting action executed in the current turn (e.g. bash command).
   */
  recordSideEffect(description: string): void {
    if (!this.currentTurn) return;
    this.currentTurn.sideEffects.push(description);
  }

  /**
   * Captures the state of a file before a mutating tool modifies it.
   */
  capture(workspaceRoot: string, relPath: string): void {
    if (!this.currentTurn) return;
    const normalized = relPath.replace(/\\/g, "/");
    // Only capture the first state of this file in the current turn
    if (this.currentTurn.files.has(normalized)) return;

    const absPath = path.join(workspaceRoot, normalized);
    const exists = fs.existsSync(absPath);
    let content: string | null = null;
    if (exists) {
      try {
        content = fs.readFileSync(absPath, "utf8");
      } catch {
        // Binary or unreadable
      }
    }

    this.currentTurn.files.set(normalized, {
      relPath: normalized,
      exists,
      content,
    });
  }

  /**
   * Reverts changes made in the latest turn or back to a specific turn.
   */
  rollback(workspaceRoot: string, targetTurn?: number): { restored: string[]; deleted: string[]; sideEffects: string[] } {
    if (this.history.length === 0) {
      throw new Error("No previous snapshots found to rollback.");
    }

    const turnToRevert = targetTurn
      ? this.history.find((t) => t.turn === targetTurn)
      : this.history[this.history.length - 1];

    if (!turnToRevert) {
      throw new Error(`Snapshot turn #${targetTurn} not found.`);
    }

    const restored: string[] = [];
    const deleted: string[] = [];

    for (const [, snap] of turnToRevert.files) {
      const abs = path.join(workspaceRoot, snap.relPath);
      if (snap.exists && snap.content !== null) {
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, snap.content, "utf8");
        restored.push(snap.relPath);
      } else if (!snap.exists) {
        if (fs.existsSync(abs)) {
          fs.unlinkSync(abs);
          deleted.push(snap.relPath);
        }
      }
    }

    return { restored, deleted, sideEffects: [...turnToRevert.sideEffects] };
  }

  listCheckpoints(): Array<{ turn: number; time: string; files: string[] }> {
    return this.history.map((t) => ({
      turn: t.turn,
      time: new Date(t.timestamp).toLocaleTimeString(),
      files: [...t.files.keys()],
    }));
  }
}

export function rollbackTool(ws: Workspace, snapshots: SnapshotManager) {
  return {
    name: "rollback",
    description: "Rollback file modifications made during the current or previous turn back to their pre-turn state.",
    parameters: {
      type: "object",
      properties: {
        turn: { type: "number", description: "Optional specific turn number to revert (defaults to latest turn)" },
      },
      required: [],
    },
    schema: z.object({
      turn: z.number().int().min(1).optional(),
    }),
    async execute(args: { turn?: number }): Promise<string> {
      try {
        const { restored, deleted, sideEffects } = snapshots.rollback(ws.root, args.turn);
        const parts: string[] = [];
        if (restored.length > 0) parts.push(`Restored original: ${restored.join(", ")}`);
        if (deleted.length > 0) parts.push(`Removed newly created: ${deleted.join(", ")}`);
        if (sideEffects.length > 0) {
          parts.push(`Note: The following side-effecting commands were run during this turn and cannot be automatically reverted:\n${sideEffects.map((s) => `  - ${s}`).join("\n")}`);
        }
        if (parts.length === 0) return "No files were modified in that turn.";
        return `Rollback completed successfully.\n${parts.join("\n")}`;
      } catch (err: any) {
        return `Rollback failed: ${err.message}`;
      }
    },
  };
}
