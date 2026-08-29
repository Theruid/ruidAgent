import { spawn } from "node:child_process";
import type { HookConfig, HookRule } from "./config.js";

export interface HookEvent {
  event: "preToolUse" | "postToolUse";
  tool: string;
  input: unknown;
  sessionId?: string;
  workspaceRoot: string;
  result?: {
    content: string;
    isError: boolean;
  };
}

export interface HookExecutionResult {
  allow: boolean;
  reason?: string;
  hookCommand?: string;
}

/**
 * Checks whether a given tool name matches the rule's tool selector.
 * Empty or "*" matches everything.
 * Trailing "*" performs prefix matching (e.g. "mcp__*").
 */
export function matchesToolFilter(toolName: string, pattern?: string): boolean {
  if (!pattern || pattern === "*") return true;
  if (pattern.endsWith("*")) {
    const prefix = pattern.slice(0, -1);
    return toolName.startsWith(prefix);
  }
  return toolName === pattern;
}

/**
 * Executes a single hook rule asynchronously.
 * Hook receives JSON on stdin and env variables:
 * - RUID_HOOK_EVENT: "preToolUse" | "postToolUse"
 * - RUID_TOOL_NAME: tool name
 * - RUID_SESSION_ID: current session ID
 * - RUID_WORKSPACE: workspace root
 *
 * Exit codes:
 * - 0: Allowed / Success
 * - 2: Rejected by hook rule (reason extracted from stderr or fallback)
 * - Any other non-zero or timeout: Denied (fail-closed for security)
 */
export async function executeHookRule(
  rule: HookRule,
  event: HookEvent
): Promise<{ success: boolean; exitCode: number | null; stderr: string; stdout: string }> {
  return new Promise((resolve) => {
    const timeoutMs = rule.timeoutMs ?? 10000;
    let timer: NodeJS.Timeout | null = null;
    let stdoutBuf = "";
    let stderrBuf = "";
    let finished = false;

    const child = spawn(rule.command, {
      shell: true,
      cwd: event.workspaceRoot,
      env: {
        ...process.env,
        RUID_HOOK_EVENT: event.event,
        RUID_TOOL_NAME: event.tool,
        RUID_SESSION_ID: event.sessionId ?? "",
        RUID_WORKSPACE: event.workspaceRoot,
      },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });

    const cleanup = () => {
      if (timer) clearTimeout(timer);
    };

    timer = setTimeout(() => {
      if (!finished) {
        finished = true;
        cleanup();
        try {
          child.kill("SIGKILL");
        } catch {}
        resolve({
          success: false,
          exitCode: null,
          stderr: `Hook execution timed out after ${timeoutMs}ms`,
          stdout: stdoutBuf,
        });
      }
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdoutBuf += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderrBuf += chunk.toString();
    });

    child.on("error", (err) => {
      if (!finished) {
        finished = true;
        cleanup();
        resolve({
          success: false,
          exitCode: null,
          stderr: `Hook failed to spawn: ${err.message}`,
          stdout: stdoutBuf,
        });
      }
    });

    child.on("close", (code) => {
      if (!finished) {
        finished = true;
        cleanup();
        resolve({
          success: code === 0,
          exitCode: code,
          stderr: stderrBuf.trim(),
          stdout: stdoutBuf.trim(),
        });
      }
    });

    try {
      child.stdin.write(JSON.stringify(event));
      child.stdin.end();
    } catch {
      // Child process closed early
    }
  });
}

/**
 * Runs all applicable hooks for a given lifecycle stage.
 * Pre-hooks enforce a fail-closed boundary: if any hook fails or rejects, the tool call is blocked.
 */
export async function runHooks(
  stage: "preToolUse" | "postToolUse",
  hooks: HookConfig | undefined,
  event: HookEvent
): Promise<HookExecutionResult> {
  if (!hooks) return { allow: true };

  const rules: HookRule[] = (stage === "preToolUse" ? hooks.preToolUse : hooks.postToolUse) ?? [];
  const applicable = rules.filter((r) => matchesToolFilter(event.tool, r.tool));

  for (const rule of applicable) {
    const res = await executeHookRule(rule, event);

    if (stage === "preToolUse") {
      if (!res.success) {
        const fallbackReason =
          res.exitCode === 2
            ? res.stderr || `Blocked by preToolUse hook (${rule.command})`
            : res.stderr || `Pre-tool hook error (exit code ${res.exitCode ?? "timeout"})`;

        return {
          allow: false,
          reason: fallbackReason,
          hookCommand: rule.command,
        };
      }
    }
  }

  return { allow: true };
}
