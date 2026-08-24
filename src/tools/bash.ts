import { z } from "zod";
import { spawn } from "node:child_process";
import type { Workspace } from "./fs.js";

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_BYTES = 200 * 1024;

export function bashTool(ws: Workspace) {
  return {
    name: "bash",
    description:
      "Execute a shell command in the workspace root. On Windows runs via cmd.exe /c, otherwise /bin/sh. Output is truncated at 200KB. Times out after 2 minutes by default.",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "The shell command to run" },
        timeout_ms: { type: "number", description: "Timeout in ms (default 120000, max 600000)" },
      },
      required: ["command"],
    },
    schema: z.object({
      command: z.string().min(1),
      timeout_ms: z.number().int().min(1000).max(600_000).optional(),
    }),
    async execute(args: { command: string; timeout_ms?: number }): Promise<string> {
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
          stdout = cap(d.toString(), stdout);
        });
        child.stderr.on("data", (d: Buffer) => {
          stderr = cap(d.toString(), stderr);
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
