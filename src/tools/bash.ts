import { z } from "zod";
import { spawn, type ChildProcess } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Workspace } from "./fs.js";
import { ensureConfigDir } from "../config.js";

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_BYTES = 200 * 1024;

export interface ProcessInfo {
  id: string;
  command: string;
  startTime: number;
  status: "running" | "completed" | "failed" | "killed";
  exitCode: number | null;
  logFilePath: string;
}

export class ProcessManager {
  private processes = new Map<string, { child: ChildProcess; info: ProcessInfo }>();

  private taskLogsDir(): string {
    const dir = join(ensureConfigDir(), "tasks");
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  spawnBackground(command: string, cwd: string): ProcessInfo {
    const id = `proc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const logFilePath = join(this.taskLogsDir(), `${id}.log`);
    const isWindows = process.platform === "win32";

    const child = spawn(isWindows ? "cmd.exe" : "/bin/sh", isWindows ? ["/c", command] : ["-c", command], {
      cwd,
      detached: true,
      env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
    });

    const info: ProcessInfo = {
      id,
      command,
      startTime: Date.now(),
      status: "running",
      exitCode: null,
      logFilePath,
    };

    child.stdout?.on("data", (d: Buffer) => {
      try {
        appendFileSync(logFilePath, d.toString(), "utf8");
      } catch {}
    });

    child.stderr?.on("data", (d: Buffer) => {
      try {
        appendFileSync(logFilePath, d.toString(), "utf8");
      } catch {}
    });

    child.on("close", (code) => {
      info.exitCode = code;
      info.status = code === 0 ? "completed" : "failed";
    });

    child.on("error", () => {
      info.status = "failed";
    });

    this.processes.set(id, { child, info });
    return info;
  }

  list(): ProcessInfo[] {
    return Array.from(this.processes.values()).map((p) => ({ ...p.info }));
  }

  getStatus(id: string): ProcessInfo | null {
    return this.processes.get(id)?.info ?? null;
  }

  getLogs(id: string, maxLines = 100): string {
    const info = this.getStatus(id);
    if (!info || !existsSync(info.logFilePath)) return "(no logs available)";
    try {
      const raw = readFileSync(info.logFilePath, "utf8");
      const lines = raw.split("\n");
      const sliced = lines.slice(-maxLines);
      return sliced.join("\n");
    } catch (e) {
      return `Failed to read logs: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  kill(id: string): boolean {
    const entry = this.processes.get(id);
    if (!entry) return false;
    try {
      entry.child.kill("SIGKILL");
      entry.info.status = "killed";
      return true;
    } catch {
      return false;
    }
  }
}

export function bashTool(
  ws: Workspace,
  processManager?: ProcessManager,
  onChunk?: (chunk: string, stream: "stdout" | "stderr") => void
) {
  return {
    name: "bash",
    description:
      "Execute a shell command in the workspace root. Supports foreground live execution and run_in_background for long tasks.",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "The shell command to run" },
        timeout_ms: { type: "number", description: "Timeout in ms (default 120000, max 600000)" },
        run_in_background: { type: "boolean", description: "Run process detached in background (default false)" },
      },
      required: ["command"],
    },
    schema: z.object({
      command: z.string().min(1),
      timeout_ms: z.number().int().min(1000).max(600_000).optional(),
      run_in_background: z.boolean().optional().default(false),
    }),
    async execute(args: { command: string; timeout_ms?: number; run_in_background?: boolean }): Promise<string> {
      if (args.run_in_background) {
        const pm = processManager ?? new ProcessManager();
        const info = pm.spawnBackground(args.command, ws.root);
        return `Background process started.\nTask ID: ${info.id}\nCommand: ${info.command}\nLogs: ${info.logFilePath}\nUse process_logs or process_status with "${info.id}" to inspect progress.`;
      }

      const timeout = args.timeout_ms ?? DEFAULT_TIMEOUT_MS;
      const isWindows = process.platform === "win32";

      return new Promise((resolve) => {
        const child = spawn(isWindows ? "cmd.exe" : "/bin/sh", isWindows ? ["/c", args.command] : ["-c", args.command], {
          cwd: ws.root,
          env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
        });

        let stdout = "";
        let stderr = "";
        let truncated = false;

        const cap = (chunk: string, target: string): string => {
          if (stdout.length + stderr.length >= MAX_OUTPUT_BYTES) {
            truncated = true;
            return target;
          }
          return target + chunk;
        };

        child.stdout.on("data", (d: Buffer) => {
          const text = d.toString();
          stdout = cap(text, stdout);
          onChunk?.(text, "stdout");
        });
        child.stderr.on("data", (d: Buffer) => {
          const text = d.toString();
          stderr = cap(text, stderr);
          onChunk?.(text, "stderr");
        });

        const timer = setTimeout(() => {
          child.kill("SIGKILL");
          resolve(`Command timed out after ${timeout}ms.\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`);
        }, timeout);

        child.on("error", (err) => {
          clearTimeout(timer);
          resolve(`Failed to spawn: ${err.message}`);
        });

        child.on("close", (code) => {
          clearTimeout(timer);
          const suffix = truncated ? "\n(output truncated)" : "";
          resolve(
            `Exit code: ${code ?? "null"}\n` +
              (stdout ? `STDOUT:\n${stdout}\n` : "") +
              (stderr ? `STDERR:\n${stderr}\n` : "") +
              suffix,
          );
        });
      });
    },
  };
}

export function processStatusTool(pm: ProcessManager) {
  return {
    name: "process_status",
    description: "Check status and state of background tasks started with bash.",
    parameters: {
      type: "object",
      properties: {
        process_id: { type: "string", description: "Optional background process ID (if omitted, lists all)" },
      },
      required: [],
    },
    schema: z.object({ process_id: z.string().optional() }),
    async execute(args: { process_id?: string }): Promise<string> {
      if (args.process_id) {
        const info = pm.getStatus(args.process_id);
        if (!info) return `Process not found: ${args.process_id}`;
        return JSON.stringify(info, null, 2);
      }
      const list = pm.list();
      if (list.length === 0) return "No background processes active.";
      return list
        .map((p) => `[${p.id}] Status: ${p.status} (exit: ${p.exitCode ?? "?"}) - Command: ${p.command}`)
        .join("\n");
    },
  };
}

export function processLogsTool(pm: ProcessManager) {
  return {
    name: "process_logs",
    description: "Read the latest stdout/stderr logs from a background task.",
    parameters: {
      type: "object",
      properties: {
        process_id: { type: "string", description: "Background process ID" },
        lines: { type: "number", description: "Number of tail lines to retrieve (default 100)" },
      },
      required: ["process_id"],
    },
    schema: z.object({
      process_id: z.string().min(1),
      lines: z.number().int().min(1).max(1000).optional().default(100),
    }),
    async execute(args: { process_id: string; lines?: number }): Promise<string> {
      return pm.getLogs(args.process_id, args.lines ?? 100);
    },
  };
}

export function processKillTool(pm: ProcessManager) {
  return {
    name: "process_kill",
    description: "Terminate a running background task.",
    parameters: {
      type: "object",
      properties: {
        process_id: { type: "string", description: "Background process ID to kill" },
      },
      required: ["process_id"],
    },
    schema: z.object({ process_id: z.string().min(1) }),
    async execute(args: { process_id: string }): Promise<string> {
      const ok = pm.kill(args.process_id);
      return ok ? `Killed process ${args.process_id}` : `Could not kill process ${args.process_id}`;
    },
  };
}
