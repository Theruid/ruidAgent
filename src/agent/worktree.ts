import { spawn } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

export interface WorktreeInstance {
  path: string;
  branch: string;
  cleanup(): Promise<void>;
  diff(): Promise<string>;
}

function execGit(args: string[], cwd: string): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const child = spawn("git", args, { cwd, env: { ...process.env, NO_COLOR: "1" } });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    child.on("close", (code) => resolve({ stdout, stderr, code: code ?? 1 }));
  });
}

/**
 * Creates an isolated git worktree in a temporary directory for safe concurrent subagent modifications.
 */
export async function createWorktree(workspaceRoot: string): Promise<WorktreeInstance> {
  const rand = Math.random().toString(36).slice(2, 8);
  const branch = `subagent-worktree-${rand}`;
  const targetPath = join(tmpdir(), `ruid-worktree-${rand}`);

  // Create worktree on a new temporary branch
  const res = await execGit(["worktree", "add", "-b", branch, targetPath, "HEAD"], workspaceRoot);
  if (res.code !== 0) {
    throw new Error(`Failed to create git worktree: ${res.stderr || res.stdout}`);
  }

  return {
    path: targetPath,
    branch,
    async diff(): Promise<string> {
      const diffRes = await execGit(["diff", "HEAD"], targetPath);
      return diffRes.stdout;
    },
    async cleanup(): Promise<void> {
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
