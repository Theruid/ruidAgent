import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import type { Workspace } from "./fs.js";
import { ensureConfigDir } from "../config.js";

const execFileAsync = promisify(execFile);

export interface GitTurnCheckpoint {
  turn: number;
  timestamp: number;
  isGit: boolean;
  ref: string;
  untrackedFiles: string[];
  modifiedFiles: string[];
  sideEffects: string[];
}

interface SerializedGitTurnCheckpoint {
  turn: number;
  timestamp: number;
  isGit: boolean;
  ref: string;
  untrackedFiles: string[];
  modifiedFiles: string[];
  sideEffects: string[];
}

async function runGit(args: string[], cwd: string): Promise<{ stdout: string; stderr: string; success: boolean }> {
  try {
    const res = await execFileAsync("git", args, {
      cwd,
      maxBuffer: 20 * 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
    return { stdout: res.stdout, stderr: res.stderr, success: true };
  } catch (err: any) {
    return {
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? err.message,
      success: false,
    };
  }
}

function snapshotsDir(): string {
  const dir = path.join(ensureConfigDir(), "snapshots");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export class GitCheckpointManager {
  private history: GitTurnCheckpoint[] = [];
  private currentTurn: GitTurnCheckpoint | null = null;
  private turnCounter = 1;
  private sessionId: string | null = null;

  attachSession(sessionId: string): void {
    this.sessionId = sessionId;
    this.history = [];
    this.currentTurn = null;
    this.turnCounter = 1;

    const file = path.join(snapshotsDir(), `${sessionId}.git-checkpoints.json`);
    if (fs.existsSync(file)) {
      try {
        const raw = JSON.parse(fs.readFileSync(file, "utf8"));
        if (Array.isArray(raw)) {
          this.history = raw.map((item: SerializedGitTurnCheckpoint) => ({
            turn: item.turn,
            timestamp: item.timestamp,
            isGit: item.isGit,
            ref: item.ref,
            untrackedFiles: item.untrackedFiles ?? [],
            modifiedFiles: item.modifiedFiles ?? [],
            sideEffects: item.sideEffects ?? [],
          }));
          if (this.history.length > 0) {
            const maxTurn = Math.max(...this.history.map((t) => t.turn), 0);
            this.turnCounter = maxTurn + 1;
          }
        }
      } catch {}
    }
  }

  private persist(): void {
    if (!this.sessionId) return;
    try {
      const serialized: SerializedGitTurnCheckpoint[] = this.history.map((t) => ({
        turn: t.turn,
        timestamp: t.timestamp,
        isGit: t.isGit,
        ref: t.ref,
        untrackedFiles: t.untrackedFiles,
        modifiedFiles: t.modifiedFiles,
        sideEffects: t.sideEffects,
      }));

      const targetFile = path.join(snapshotsDir(), `${this.sessionId}.git-checkpoints.json`);
      const tempFile = path.join(snapshotsDir(), `${this.sessionId}.git-checkpoints.json.tmp`);
      fs.writeFileSync(tempFile, JSON.stringify(serialized, null, 2), "utf8");
      fs.renameSync(tempFile, targetFile);
    } catch {}
  }

  recordSideEffect(description: string): void {
    if (!this.currentTurn) return;
    this.currentTurn.sideEffects.push(description);
    this.persist();
  }

  async beginTurn(workspaceRoot: string): Promise<void> {
    const gitCheck = await runGit(["rev-parse", "--is-inside-work-tree"], workspaceRoot);
    const isGit = gitCheck.success && gitCheck.stdout.trim() === "true";

    const untrackedFiles: string[] = [];
    const modifiedFiles: string[] = [];
    const turnNumber = this.turnCounter++;
    const ref = `refs/ruid/checkpoints/${this.sessionId || "default"}/${turnNumber}`;

    if (isGit) {
      const statusRes = await runGit(["status", "--porcelain=v1", "-uall"], workspaceRoot);
      if (statusRes.success && statusRes.stdout) {
        const lines = statusRes.stdout.split("\n").filter(Boolean);
        for (const line of lines) {
          const status = line.slice(0, 2);
          const rawPath = line.slice(3).trim().replace(/^"|"$/g, "").replace(/\\/g, "/");
          if (status === "??" || status === " A") {
            untrackedFiles.push(rawPath);
          } else {
            modifiedFiles.push(rawPath);
          }
        }
      }

      // Create durable snapshot ref in git object store
      try {
        const indexTmp = path.join(workspaceRoot, ".git", `ruid-index-${turnNumber}.tmp`);
        await runGit(["add", "-A", "--force", "."], workspaceRoot);
        const writeTree = await runGit(["write-tree"], workspaceRoot);
        if (writeTree.success && writeTree.stdout.trim()) {
          const treeSha = writeTree.stdout.trim();
          const headCommit = (await runGit(["rev-parse", "HEAD"], workspaceRoot)).stdout.trim();
          const commitArgs = headCommit
            ? ["commit-tree", treeSha, "-p", headCommit, "-m", `ruid checkpoint turn ${turnNumber}`]
            : ["commit-tree", treeSha, "-m", `ruid checkpoint turn ${turnNumber}`];
          const commitRes = await runGit(commitArgs, workspaceRoot);
          if (commitRes.success && commitRes.stdout.trim()) {
            const commitSha = commitRes.stdout.trim();
            await runGit(["update-ref", ref, commitSha], workspaceRoot);
          }
        }
        if (fs.existsSync(indexTmp)) fs.unlinkSync(indexTmp);
      } catch {}
    }

    this.currentTurn = {
      turn: turnNumber,
      timestamp: Date.now(),
      isGit,
      ref,
      untrackedFiles,
      modifiedFiles,
      sideEffects: [],
    };
    this.history.push(this.currentTurn);
    if (this.history.length > 30) {
      this.history = this.history.slice(-30);
    }
    this.persist();
  }

  async rollback(
    workspaceRoot: string,
    targetTurn?: number
  ): Promise<{ restored: string[]; deleted: string[]; deletedDirs: string[]; sideEffects: string[] }> {
    if (this.history.length === 0) {
      throw new Error("No previous snapshots found to rollback.");
    }

    const checkpoint = targetTurn
      ? this.history.find((t) => t.turn === targetTurn)
      : this.history[this.history.length - 1];

    if (!checkpoint) {
      throw new Error(`Snapshot turn #${targetTurn} not found.`);
    }

    const restored: string[] = [];
    const deleted: string[] = [];
    const deletedDirs: string[] = [];

    if (checkpoint.isGit) {
      const currentStatusRes = await runGit(["status", "--porcelain=v1", "-uall"], workspaceRoot);
      const preUntrackedSet = new Set(checkpoint.untrackedFiles);
      const preModifiedSet = new Set(checkpoint.modifiedFiles);

      if (currentStatusRes.success && currentStatusRes.stdout) {
        const lines = currentStatusRes.stdout.split("\n").filter(Boolean);
        for (const line of lines) {
          const status = line.slice(0, 2);
          const rawPath = line.slice(3).trim().replace(/^"|"$/g, "").replace(/\\/g, "/");
          const abs = path.join(workspaceRoot, rawPath);

          // 1. Untracked file created during this turn
          if (status === "??" || status === " A" || status === "AM") {
            if (!preUntrackedSet.has(rawPath)) {
              try {
                if (fs.existsSync(abs)) {
                  fs.rmSync(abs, { recursive: true, force: true });
                  deleted.push(rawPath);
                }
              } catch {}
            }
          }
          // 2. Tracked file modified during turn
          else {
            if (!preModifiedSet.has(rawPath)) {
              const checkoutRes = await runGit(["checkout", "HEAD", "--", rawPath], workspaceRoot);
              if (checkoutRes.success) {
                restored.push(rawPath);
              }
            } else if (checkpoint.ref) {
              // Checkout from checkpoint ref tree
              const restoreRef = await runGit(["checkout", checkpoint.ref, "--", rawPath], workspaceRoot);
              if (restoreRef.success) {
                restored.push(rawPath);
              }
            }
          }
        }
      }

      // Clean up empty directories inside workspace
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
    }

    this.persist();
    return { restored, deleted, deletedDirs, sideEffects: [...checkpoint.sideEffects] };
  }
}

export function gitRollbackTool(ws: Workspace, checkpoints: GitCheckpointManager) {
  return {
    name: "rollback",
    description: "Rollback working tree modifications made during the current or previous turn back to their pre-turn git state.",
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
        const { restored, deleted, deletedDirs, sideEffects } = await checkpoints.rollback(ws.root, args.turn);
        const parts: string[] = [];
        if (restored.length > 0) parts.push(`Restored original: ${restored.join(", ")}`);
        if (deleted.length > 0) parts.push(`Removed newly created files: ${deleted.join(", ")}`);
        if (deletedDirs && deletedDirs.length > 0) parts.push(`Removed newly created directories: ${deletedDirs.join(", ")}`);
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
