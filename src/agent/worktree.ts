import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

const execFileAsync = promisify(execFile);

export interface WorktreeInstance {
  path: string;
  branch: string;
  cleanup(): Promise<void>;
  diff(): Promise<string>;
}

async function execGit(args: string[], cwd: string): Promise<{ stdout: string; stderr: string; code: number }> {
  try {
    const res = await execFileAsync("git", args, {
      cwd,
      maxBuffer: 10 * 1024 * 1024,
      env: { ...process.env, NO_COLOR: "1", GIT_TERMINAL_PROMPT: "0" },
    });
    return { stdout: res.stdout, stderr: res.stderr, code: 0 };
  } catch (err: any) {
    return {
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? err.message,
      code: err.code ?? 1,
    };
  }
}

// Global active worktree registry for graceful process exit cleanup
const activeWorktrees = new Set<{ path: string; branch: string; workspaceRoot: string }>();

function registerExitHandlers(): void {
  const cleanupAll = () => {
    for (const wt of activeWorktrees) {
      try {
        if (existsSync(wt.path)) {
          rmSync(wt.path, { recursive: true, force: true });
        }
      } catch {}
    }
  };

  process.once("exit", cleanupAll);
  process.once("SIGINT", () => {
    cleanupAll();
    process.exit(130);
  });
  process.once("SIGTERM", () => {
    cleanupAll();
    process.exit(143);
  });
}

let handlersRegistered = false;
function ensureHandlers(): void {
  if (!handlersRegistered) {
    registerExitHandlers();
    handlersRegistered = true;
  }
}

/**
 * Creates an isolated git worktree in a temporary directory for safe concurrent subagent modifications.
 */
export async function createWorktree(workspaceRoot: string): Promise<WorktreeInstance> {
  ensureHandlers();
  const id = randomUUID().slice(0, 8);
  const branch = `subagent-worktree-${id}`;
  const targetPath = join(tmpdir(), `ruid-worktree-${id}`);

  // Create worktree on a new temporary branch
  const res = await execGit(["worktree", "add", "-b", branch, targetPath, "HEAD"], workspaceRoot);
  if (res.code !== 0) {
    throw new Error(`Failed to create git worktree: ${res.stderr || res.stdout}`);
  }

  const record = { path: targetPath, branch, workspaceRoot };
  activeWorktrees.add(record);

  return {
    path: targetPath,
    branch,
    async diff(): Promise<string> {
      const diffRes = await execGit(["diff", "HEAD"], targetPath);
      return diffRes.stdout;
    },
    async cleanup(): Promise<void> {
      activeWorktrees.delete(record);
      try {
        await execGit(["worktree", "remove", "--force", targetPath], workspaceRoot);
        await execGit(["branch", "-D", branch], workspaceRoot);
      } catch {
        // Fallback directory removal if git command failed
        if (existsSync(targetPath)) {
          rmSync(targetPath, { recursive: true, force: true });
        }
      }
    },
  };
}

/**
 * Sweeps and prunes abandoned temporary worktree directories and branches.
 */
export async function sweepOrphanedWorktrees(workspaceRoot: string): Promise<{ cleanedCount: number }> {
  let cleanedCount = 0;
  try {
    const listRes = await execGit(["worktree", "list", "--porcelain"], workspaceRoot);
    if (listRes.code === 0 && listRes.stdout) {
      const blocks = listRes.stdout.split("\n\n");
      for (const block of blocks) {
        const lines = block.split("\n");
        const worktreeLine = lines.find((l) => l.startsWith("worktree "));
        const branchLine = lines.find((l) => l.startsWith("branch "));
        if (worktreeLine) {
          const wtPath = worktreeLine.slice("worktree ".length).trim();
          if (wtPath.includes("ruid-worktree-")) {
            await execGit(["worktree", "remove", "--force", wtPath], workspaceRoot).catch(() => {});
            if (existsSync(wtPath)) {
              rmSync(wtPath, { recursive: true, force: true });
            }
            if (branchLine) {
              const fullBranch = branchLine.slice("branch ".length).trim();
              const branchName = fullBranch.replace(/^refs\/heads\//, "");
              if (branchName.startsWith("subagent-worktree-")) {
                await execGit(["branch", "-D", branchName], workspaceRoot).catch(() => {});
              }
            }
            cleanedCount++;
          }
        }
      }
      await execGit(["worktree", "prune"], workspaceRoot);
    }
  } catch {}
  return { cleanedCount };
}
