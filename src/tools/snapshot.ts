import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { Workspace } from "./fs.js";
import { ensureConfigDir } from "../config.js";

export const MAX_SNAPSHOT_FILE_BYTES = 1024 * 1024; // 1MB per-file capture limit
export const MAX_SNAPSHOT_TURNS = 25; // Keep last 25 turns

export interface FileSnapshot {
  relPath: string;
  exists: boolean;
  content: string | null;
  encoding?: "utf8" | "base64";
  skippedTooLarge?: boolean;
}

export interface TurnSnapshot {
  turn: number;
  timestamp: number;
  files: Map<string, FileSnapshot>;
  directoriesCreated: string[];
  sideEffects: string[];
}

interface SerializedTurnSnapshot {
  turn: number;
  timestamp: number;
  files: Array<[string, FileSnapshot]>;
  directoriesCreated?: string[];
  sideEffects: string[];
}

function snapshotsDir(): string {
  const dir = path.join(ensureConfigDir(), "snapshots");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export class SnapshotManager {
  private history: TurnSnapshot[] = [];
  private currentTurn: TurnSnapshot | null = null;
  private turnCounter = 1;
  private sessionId: string | null = null;

  attachSession(sessionId: string): void {
    this.sessionId = sessionId;
    this.history = [];
    this.currentTurn = null;
    this.turnCounter = 1;

    const file = path.join(snapshotsDir(), `${sessionId}.snapshots.json`);
    if (fs.existsSync(file)) {
      try {
        const raw = JSON.parse(fs.readFileSync(file, "utf8"));
        if (Array.isArray(raw)) {
          this.history = raw.map((item: SerializedTurnSnapshot) => ({
            turn: item.turn,
            timestamp: item.timestamp,
            files: new Map(item.files),
            directoriesCreated: item.directoriesCreated ?? [],
            sideEffects: item.sideEffects ?? [],
          }));
          if (this.history.length > 0) {
            const maxTurn = Math.max(...this.history.map((t) => t.turn), 0);
            this.turnCounter = maxTurn + 1;
          }
        }
      } catch {
        // Fall back to clean state on corrupted snapshot file
      }
    }
  }

  private persist(): void {
    if (!this.sessionId) return;
    try {
      const serialized: SerializedTurnSnapshot[] = this.history.map((t) => ({
        turn: t.turn,
        timestamp: t.timestamp,
        files: [...t.files.entries()],
        directoriesCreated: t.directoriesCreated,
        sideEffects: t.sideEffects,
      }));

      const targetFile = path.join(snapshotsDir(), `${this.sessionId}.snapshots.json`);
      const tempFile = path.join(snapshotsDir(), `${this.sessionId}.snapshots.json.tmp`);
      fs.writeFileSync(tempFile, JSON.stringify(serialized, null, 2), "utf8");
      fs.renameSync(tempFile, targetFile);
    } catch {
      // Non-fatal if snapshot persistence fails
    }
  }

  private prune(): void {
    if (this.history.length > MAX_SNAPSHOT_TURNS) {
      this.history = this.history.slice(-MAX_SNAPSHOT_TURNS);
    }
  }

  beginTurn(): void {
    this.currentTurn = {
      turn: this.turnCounter++,
      timestamp: Date.now(),
      files: new Map(),
      directoriesCreated: [],
      sideEffects: [],
    };
    this.history.push(this.currentTurn);
    this.prune();
    this.persist();
  }

  /**
   * Records directories that are about to be created so they can be cleaned up on rollback.
   */
  recordDirectoryCreation(workspaceRoot: string, targetDirPath: string): void {
    if (!this.currentTurn) return;
    const normTarget = path.normalize(targetDirPath);
    const normRoot = path.normalize(workspaceRoot);
    if (!normTarget.startsWith(normRoot)) return;

    // Walk upwards from targetDirPath toward workspaceRoot, recording directories that don't exist yet
    let curr = normTarget;
    const toRecord: string[] = [];
    while (curr !== normRoot && curr.startsWith(normRoot + path.sep)) {
      if (!fs.existsSync(curr)) {
        const rel = path.relative(normRoot, curr).replace(/\\/g, "/");
        toRecord.push(rel);
        curr = path.dirname(curr);
      } else {
        break;
      }
    }

    for (const rel of toRecord) {
      if (!this.currentTurn.directoriesCreated.includes(rel)) {
        this.currentTurn.directoriesCreated.push(rel);
      }
    }
  }

  /**
   * Records an unrevertable side-effecting action executed in the current turn (e.g. bash command).
   */
  recordSideEffect(description: string): void {
    if (!this.currentTurn) return;
    this.currentTurn.sideEffects.push(description);
    this.persist();
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
    let encoding: "utf8" | "base64" = "utf8";
    let skippedTooLarge = false;

    if (exists) {
      try {
        const stat = fs.statSync(absPath);
        if (stat.size > MAX_SNAPSHOT_FILE_BYTES) {
          skippedTooLarge = true;
        } else {
          const buf = fs.readFileSync(absPath);
          // Check for binary content (NUL byte in first 8000 bytes)
          const checkLen = Math.min(buf.length, 8000);
          let isBinary = false;
          for (let i = 0; i < checkLen; i++) {
            if (buf[i] === 0) {
              isBinary = true;
              break;
            }
          }

          if (isBinary) {
            content = buf.toString("base64");
            encoding = "base64";
          } else {
            content = buf.toString("utf8");
            encoding = "utf8";
          }
        }
      } catch {
        // Binary or unreadable
      }
    }

    this.currentTurn.files.set(normalized, {
      relPath: normalized,
      exists,
      content,
      encoding,
      skippedTooLarge,
    });
    this.persist();
  }

  /**
   * Reverts changes made in the latest turn or back to a specific turn.
   */
  rollback(
    workspaceRoot: string,
    targetTurn?: number
  ): { restored: string[]; deleted: string[]; deletedDirs: string[]; skipped: string[]; sideEffects: string[] } {
    if (this.history.length === 0) {
      throw new Error("No previous snapshots found to rollback.");
    }

    let turnToRevert: TurnSnapshot | undefined;
    if (targetTurn) {
      turnToRevert = this.history.find((t) => t.turn === targetTurn);
    } else {
      // Default: revert the most recent turn that actually recorded file
      // modifications or directory creations.
      turnToRevert = [...this.history]
        .reverse()
        .find((t) => t.files.size > 0 || (t.directoriesCreated && t.directoriesCreated.length > 0));
    }

    if (!turnToRevert) {
      if (targetTurn) {
        throw new Error(`Snapshot turn #${targetTurn} not found.`);
      }
      throw new Error("No turns with file modifications found to rollback.");
    }

    const restored: string[] = [];
    const deleted: string[] = [];
    const deletedDirs: string[] = [];
    const skipped: string[] = [];

    for (const [, snap] of turnToRevert.files) {
      const abs = path.join(workspaceRoot, snap.relPath);
      if (snap.skippedTooLarge) {
        skipped.push(snap.relPath);
      } else if (snap.exists && snap.content !== null) {
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        const buf =
          snap.encoding === "base64"
            ? Buffer.from(snap.content, "base64")
            : Buffer.from(snap.content, "utf8");
        fs.writeFileSync(abs, buf);
        restored.push(snap.relPath);
      } else if (!snap.exists) {
        if (fs.existsSync(abs)) {
          fs.unlinkSync(abs);
          deleted.push(snap.relPath);
        }
      }
    }

    // Clean up directories that were created in this turn (deepest first)
    const dirsToDelete = [...(turnToRevert.directoriesCreated ?? [])].sort(
      (a, b) => b.split("/").length - a.split("/").length
    );

    for (const relDir of dirsToDelete) {
      const absDir = path.join(workspaceRoot, relDir);
      try {
        if (fs.existsSync(absDir)) {
          const contents = fs.readdirSync(absDir);
          if (contents.length === 0) {
            fs.rmdirSync(absDir);
            deletedDirs.push(relDir);
          }
        }
      } catch {
        // Non-empty or permission error
      }
    }

    // Also clean up any ancestor directories of deleted files that became empty
    for (const fileRel of deleted) {
      let curr = path.dirname(path.join(workspaceRoot, fileRel));
      const normRoot = path.normalize(workspaceRoot);
      while (curr !== normRoot && curr.startsWith(normRoot + path.sep)) {
        try {
          if (fs.existsSync(curr)) {
            const contents = fs.readdirSync(curr);
            if (contents.length === 0) {
              const relEmpty = path.relative(normRoot, curr).replace(/\\/g, "/");
              fs.rmdirSync(curr);
              if (!deletedDirs.includes(relEmpty)) deletedDirs.push(relEmpty);
              curr = path.dirname(curr);
            } else {
              break;
            }
          } else {
            break;
          }
        } catch {
          break;
        }
      }
    }

    this.persist();
    return { restored, deleted, deletedDirs, skipped, sideEffects: [...turnToRevert.sideEffects] };
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
    description: "Rollback file modifications made during the current or previous turn back to their pre-turn state. Defaults to the most recent turn that changed files.",
    parameters: {
      type: "object",
      properties: {
        turn: { type: "number", description: "Optional specific turn number to revert (defaults to the most recent turn with file changes)" },
      },
      required: [],
    },
    schema: z.object({
      turn: z.number().int().min(1).optional(),
    }),
    async execute(args: { turn?: number }): Promise<string> {
      try {
        const { restored, deleted, deletedDirs, skipped, sideEffects } = snapshots.rollback(ws.root, args.turn);
        const parts: string[] = [];
        if (restored.length > 0) parts.push(`Restored original: ${restored.join(", ")}`);
        if (deleted.length > 0) parts.push(`Removed newly created: ${deleted.join(", ")}`);
        if (deletedDirs && deletedDirs.length > 0) parts.push(`Removed newly created directories: ${deletedDirs.join(", ")}`);
        if (skipped.length > 0) {
          parts.push(`Skipped (exceeded 1MB limit when captured): ${skipped.join(", ")}`);
        }
        if (sideEffects.length > 0) {
          parts.push(
            `Note: The following side-effecting commands were run during this turn and cannot be automatically reverted:\n${sideEffects
              .map((s) => `  - ${s}`)
              .join("\n")}`
          );
        }
        if (parts.length === 0) return "No files or directories were modified in that turn.";
        return `Rollback completed successfully.\n${parts.join("\n")}`;
      } catch (err: any) {
        return `Rollback failed: ${err.message}`;
      }
    },
  };
}
