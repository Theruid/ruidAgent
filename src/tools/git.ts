import { z } from "zod";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Workspace } from "./fs.js";

const execFileAsync = promisify(execFile);
const MAX_OUTPUT_LEN = 100 * 1024; // 100 KB

async function runGit(args: string[], cwd: string): Promise<{ stdout: string; stderr: string }> {
  try {
    const res = await execFileAsync("git", args, {
      cwd,
      maxBuffer: 5 * 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
    return { stdout: res.stdout, stderr: res.stderr };
  } catch (err: any) {
    if (err.code === "ENOENT") {
      throw new Error("git is not installed or not in PATH.");
    }
    return {
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? err.message,
    };
  }
}

export function gitStatusTool(ws: Workspace) {
  return {
    name: "git_status",
    description: "Show the current git repository status (working directory, staged, untracked files).",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
    schema: z.object({}),
    async execute(): Promise<string> {
      const { stdout, stderr } = await runGit(["status", "--short", "--branch"], ws.root);
      if (stderr && !stdout) {
        return `Git status error: ${stderr.trim()}`;
      }
      return stdout.trim() || "(clean working tree)";
    },
  };
}

export function gitDiffTool(ws: Workspace) {
  return {
    name: "git_diff",
    description: "Show git diff of staged or unstaged changes, or compare branches/commits.",
    parameters: {
      type: "object",
      properties: {
        staged: { type: "boolean", description: "Show staged changes (git diff --staged)" },
        path: { type: "string", description: "Optional specific file or directory path" },
        ref: { type: "string", description: "Optional branch or commit ref to compare against (e.g. HEAD~1, main)" },
      },
      required: [],
    },
    schema: z.object({
      staged: z.boolean().optional().default(false),
      path: z.string().optional(),
      ref: z.string().optional(),
    }),
    async execute(args: { staged?: boolean; path?: string; ref?: string }): Promise<string> {
      const gitArgs = ["diff"];
      if (args.staged) gitArgs.push("--staged");
      if (args.ref) gitArgs.push(args.ref);
      if (args.path) {
        const resolved = ws.resolve(args.path);
        const rel = ws.relative(resolved);
        gitArgs.push("--", rel);
      }

      const { stdout, stderr } = await runGit(gitArgs, ws.root);
      if (stderr && !stdout) {
        return `Git diff error: ${stderr.trim()}`;
      }
      if (!stdout.trim()) {
        return "(no diff)";
      }
      if (stdout.length > MAX_OUTPUT_LEN) {
        return stdout.slice(0, MAX_OUTPUT_LEN) + "\n... [diff truncated at 100KB]";
      }
      return stdout.trim();
    },
  };
}

export function gitLogTool(ws: Workspace) {
  return {
    name: "git_log",
    description: "Show recent git commit history.",
    parameters: {
      type: "object",
      properties: {
        maxCount: { type: "number", description: "Maximum number of commits to show (default 10, max 50)" },
      },
      required: [],
    },
    schema: z.object({
      maxCount: z.number().int().min(1).max(50).optional().default(10),
    }),
    async execute(args: { maxCount?: number }): Promise<string> {
      const count = args.maxCount ?? 10;
      const { stdout, stderr } = await runGit(
        ["log", `-${count}`, "--oneline", "--decorate"],
        ws.root
      );
      if (stderr && !stdout) {
        return `Git log error: ${stderr.trim()}`;
      }
      return stdout.trim() || "(no commit history)";
    },
  };
}
