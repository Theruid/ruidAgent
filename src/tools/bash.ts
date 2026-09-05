import { z } from "zod";
import { spawn, execSync, type ChildProcess } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Workspace } from "./fs.js";
import { ensureConfigDir } from "../config.js";
import { logAudit } from "../audit/log.js";

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_BYTES = 30 * 1024; // 30 KB cap
const HEAD_BYTES = 10 * 1024;
const TAIL_BYTES = 20 * 1024;
const PROMPT_QUIET_WINDOW_MS = 5000;
const ROLLING_BUFFER_MAX = 300;

export interface ShellConfig {
  executable: string;
  args: (command: string) => string[];
  type: "bash" | "powershell" | "cmd" | "sh";
}

let cachedShell: ShellConfig | null = null;
let cachedUserPath: string | null = null;

/**
 * Captures user interactive PATH once at startup so agent finds shims (nvm, pyenv, cargo, etc.)
 */
export function getUserPath(): string {
  if (cachedUserPath) return cachedUserPath;

  if (process.platform !== "win32") {
    try {
      const shellEnv = process.env.SHELL || "/bin/sh";
      const out = execSync(`${shellEnv} -lic 'echo "__RUID_PATH__:$PATH"'`, {
        timeout: 3000,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
      const match = out.match(/__RUID_PATH__:(.*)/);
      if (match && match[1]) {
        cachedUserPath = match[1].trim();
        return cachedUserPath;
      }
    } catch {}
  }

  cachedUserPath = process.env.PATH || "";
  return cachedUserPath;
}

export function getShell(): ShellConfig {
  if (cachedShell) return cachedShell;

  if (process.platform !== "win32") {
    // Prefer bash if available, fallback to /bin/sh
    const bashCandidates = ["/bin/bash", "/usr/bin/bash", "/usr/local/bin/bash"];
    for (const candidate of bashCandidates) {
      if (existsSync(candidate)) {
        cachedShell = {
          executable: candidate,
          args: (cmd) => ["-c", cmd],
          type: "bash",
        };
        return cachedShell;
      }
    }
    cachedShell = {
      executable: "/bin/sh",
      args: (cmd) => ["-c", cmd],
      type: "sh",
    };
    return cachedShell;
  }

  const localAppData = process.env.LOCALAPPDATA || "";
  const programFiles = process.env["ProgramFiles"] || "C:/Program Files";
  const programFilesX86 = process.env["ProgramFiles(x86)"] || "C:/Program Files (x86)";

  const gitBashCandidates = [
    join(programFiles, "Git/bin/bash.exe").replace(/\\/g, "/"),
    join(programFiles, "Git/usr/bin/bash.exe").replace(/\\/g, "/"),
    join(programFilesX86, "Git/bin/bash.exe").replace(/\\/g, "/"),
    localAppData ? join(localAppData, "Programs/Git/bin/bash.exe").replace(/\\/g, "/") : "",
  ].filter(Boolean);

  for (const candidate of gitBashCandidates) {
    if (existsSync(candidate)) {
      cachedShell = {
        executable: candidate,
        args: (cmd) => ["-c", cmd],
        type: "bash",
      };
      return cachedShell;
    }
  }

  cachedShell = {
    executable: "powershell.exe",
    args: (cmd) => ["-NoProfile", "-NonInteractive", "-Command", cmd],
    type: "powershell",
  };
  return cachedShell;
}

export function getShellInfo(): string {
  const shell = getShell();
  return `Shell: ${shell.type} (${shell.executable}) | Note: working directory (cd) does not persist between commands (use the cwd parameter).`;
}

export const NON_INTERACTIVE_ENV = {
  CI: "1",
  DEBIAN_FRONTEND: "noninteractive",
  npm_config_yes: "true",
  GIT_TERMINAL_PROMPT: "0",
  GIT_PAGER: "cat",
  PAGER: "cat",
  LESS: "-FRX",
  TERM: "dumb",
  FORCE_COLOR: "0",
  NO_COLOR: "1",
  PIP_NO_INPUT: "1",
  PYTHONUNBUFFERED: "1",
  PYTHONDONTWRITEBYTECODE: "1",
  HOMEBREW_NO_AUTO_UPDATE: "1",
  COREPACK_ENABLE_DOWNLOAD_PROMPT: "0",
  DOTNET_CLI_TELEMETRY_OPTOUT: "1",
  NEXT_TELEMETRY_DISABLED: "1",
};

export const INTERACTIVE_PROMPT_PATTERNS = [
  /\?\s+Select\b/i,
  /\?\s+Choose\b/i,
  /\[y\/n\]/i,
  /\[yes\/no\]/i,
  /\(y\/n\)/i,
  /\[Y\/n\]/i,
  /\[y\/N\]/i,
  /Password\s*:/i,
  /Enter passphrase/i,
  /Press any key to continue/i,
  /Press enter to continue/i,
  /Enter\s+[^:\n]+:\s*$/i,
  /Overwrite.*\?/i,
  /Do you want to continue\?/i,
  /Package name:\s*\(/i,
];

export function matchesInteractivePrompt(buffer: string): { matched: boolean; promptSnippet?: string } {
  for (const pattern of INTERACTIVE_PROMPT_PATTERNS) {
    const match = buffer.match(pattern);
    if (match) {
      return { matched: true, promptSnippet: match[0].trim() };
    }
  }
  return { matched: false };
}

/**
 * Strips ANSI escape codes from output strings
 */
export function stripAnsi(text: string): string {
  return text.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, "");
}

export function killProcessTree(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (!child.pid) return resolve();

    if (process.platform === "win32") {
      try {
        const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
        killer.on("close", () => resolve());
        killer.on("error", () => resolve());
      } catch {
        resolve();
      }
    } else {
      const pid = child.pid;
      if (!pid) {
        child.kill("SIGKILL");
        return resolve();
      }
      try {
        process.kill(-pid, "SIGTERM");
        const timer = setTimeout(() => {
          try {
            process.kill(-pid, "SIGKILL");
          } catch {}
          resolve();
        }, 2000);

        child.on("close", () => {
          clearTimeout(timer);
          resolve();
        });
      } catch {
        try {
          child.kill("SIGKILL");
        } catch {}
        resolve();
      }
    }
  });
}

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
    writeFileSync(logFilePath, "", "utf8");
    const shell = getShell();
    const isWindows = process.platform === "win32";

    const child = spawn(shell.executable, shell.args(command), {
      cwd,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, PATH: getUserPath(), ...NON_INTERACTIVE_ENV },
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
      killProcessTree(entry.child);
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
      "Execute a shell command in the workspace root. Supports foreground live execution and run_in_background for long tasks. Set cwd to run in a subdirectory.",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "The shell command to run" },
        cwd: { type: "string", description: "Optional working directory relative to workspace root" },
        timeout_ms: { type: "number", description: "Timeout in ms (default 120000, max 600000)" },
        run_in_background: { type: "boolean", description: "Run process detached in background (default false)" },
      },
      required: ["command"],
    },
    schema: z.object({
      command: z.string().min(1),
      cwd: z.string().optional(),
      timeout_ms: z.number().int().min(1000).max(600_000).optional(),
      run_in_background: z.boolean().optional().default(false),
    }),
    async execute(args: { command: string; cwd?: string; timeout_ms?: number; run_in_background?: boolean }): Promise<string> {
      const targetCwd = args.cwd ? ws.resolve(args.cwd) : ws.root;

      if (args.run_in_background) {
        const pm = processManager ?? new ProcessManager();
        const info = pm.spawnBackground(args.command, targetCwd);
        return `Background process started.\nTask ID: ${info.id}\nCommand: ${info.command}\nLogs: ${info.logFilePath}\nUse process_logs or process_status with "${info.id}" to inspect progress.`;
      }

      const timeout = args.timeout_ms ?? DEFAULT_TIMEOUT_MS;
      const shell = getShell();
      const isWindows = process.platform === "win32";

      return new Promise((resolve) => {
        let isResolved = false;
        let hardTimeoutTimer: NodeJS.Timeout | null = null;
        let quietTimer: NodeJS.Timeout | null = null;
        let rollingBuffer = "";

        // Spawn with closed stdin ('ignore') to ensure interactive prompts receive immediate EOF
        const child = spawn(shell.executable, shell.args(args.command), {
          cwd: targetCwd,
          detached: !isWindows,
          stdio: ["ignore", "pipe", "pipe"],
          env: { ...process.env, PATH: getUserPath(), ...NON_INTERACTIVE_ENV },
        });

        let stdout = "";
        let stderr = "";
        let truncated = false;

        const cleanupTimers = () => {
          if (hardTimeoutTimer) {
            clearTimeout(hardTimeoutTimer);
            hardTimeoutTimer = null;
          }
          if (quietTimer) {
            clearTimeout(quietTimer);
            quietTimer = null;
          }
        };

        const finish = (result: string) => {
          if (isResolved) return;
          isResolved = true;
          cleanupTimers();
          resolve(result);
        };

        const capOutput = (out: string, err: string): { stdout: string; stderr: string; wasTruncated: boolean } => {
          const cleanOut = stripAnsi(out);
          const cleanErr = stripAnsi(err);
          const total = cleanOut.length + cleanErr.length;
          if (total <= MAX_OUTPUT_BYTES) {
            return { stdout: cleanOut, stderr: cleanErr, wasTruncated: false };
          }

          let finalOut = cleanOut;
          let finalErr = cleanErr;

          if (finalOut.length > HEAD_BYTES + TAIL_BYTES) {
            const head = finalOut.slice(0, HEAD_BYTES);
            const tail = finalOut.slice(-TAIL_BYTES);
            const omitted = finalOut.length - (HEAD_BYTES + TAIL_BYTES);
            finalOut = `${head}\n\n[... ${omitted} characters omitted for context limit ...]\n\n${tail}`;
          }

          if (finalErr.length > TAIL_BYTES) {
            finalErr = finalErr.slice(-TAIL_BYTES);
          }

          return { stdout: finalOut, stderr: finalErr, wasTruncated: true };
        };

        const handleChunk = (chunkText: string, streamType: "stdout" | "stderr") => {
          if (isResolved) return;

          rollingBuffer = (rollingBuffer + chunkText).slice(-ROLLING_BUFFER_MAX);

          if (quietTimer) {
            clearTimeout(quietTimer);
            quietTimer = null;
          }

          // Secondary quiet detection only if prompt signatures appear
          const { matched, promptSnippet } = matchesInteractivePrompt(rollingBuffer);
          if (matched) {
            quietTimer = setTimeout(() => {
              if (isResolved) return;
              killProcessTree(child);
              logAudit({
                ts: Date.now(),
                source: "direct",
                tool: "bash",
                args: { command: args.command, detectedPrompt: promptSnippet },
                tier: 3,
                decision: "denied",
                error: `Interactive prompt hang: "${promptSnippet}"`,
              });

              finish(
                `Execution blocked: Command paused waiting for interactive user input ("${promptSnippet}").\n` +
                  `Process was terminated after ${PROMPT_QUIET_WINDOW_MS}ms of inactivity to prevent hanging.\n` +
                  `Fix: Re-run the command with automated flags (e.g. -y, --yes, --non-interactive, or pass required inputs via stdin/arguments).`
              );
            }, PROMPT_QUIET_WINDOW_MS);
          }

          onChunk?.(chunkText, streamType);
        };

        child.stdout?.on("data", (d: Buffer) => {
          const text = d.toString();
          stdout += text;
          handleChunk(text, "stdout");
        });

        child.stderr?.on("data", (d: Buffer) => {
          const text = d.toString();
          stderr += text;
          handleChunk(text, "stderr");
        });

        hardTimeoutTimer = setTimeout(() => {
          killProcessTree(child);
          logAudit({
            ts: Date.now(),
            source: "direct",
            tool: "bash",
            args: { command: args.command },
            tier: 3,
            decision: "denied",
            error: `Hard timeout exceeded after ${timeout}ms`,
          });
          const capped = capOutput(stdout, stderr);
          finish(
            `Command timed out after ${timeout}ms.\n` +
              `Hint: For long builds, tests, or server watchers, run with run_in_background: true and monitor using process_status or process_logs.\n` +
              `STDOUT:\n${capped.stdout}\n` +
              `STDERR:\n${capped.stderr}`
          );
        }, timeout);

        child.on("error", (err) => {
          finish(`Failed to spawn: ${err.message}`);
        });

        child.on("close", (code) => {
          const capped = capOutput(stdout, stderr);
          const suffix = capped.wasTruncated ? "\n(output capped at 30KB)" : "";
          finish(
            `Exit code: ${code ?? "null"}\n` +
              (capped.stdout ? `STDOUT:\n${capped.stdout}\n` : "") +
              (capped.stderr ? `STDERR:\n${capped.stderr}\n` : "") +
              suffix
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
