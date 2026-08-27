import { logAudit } from "./audit/log.js";

export type AgentMode = "code" | "plan" | "auto";
export type RiskTier = 0 | 1 | 2 | 3 | 4;

export interface PermissionManager {
  check(toolName: string, input: unknown, source?: "direct" | "subagent" | "background" | "mcp"): Promise<boolean>;
  getMode(): AgentMode;
  setMode(mode: AgentMode): void;
  classifyRisk(toolName: string, input: unknown): RiskTier;
}

export interface DeferredPermissions {
  manager: PermissionManager;
  respond(answer: "y" | "n" | "a"): void;
  isPending(): boolean;
  currentTool(): string | null;
  getMode(): AgentMode;
  setMode(mode: AgentMode): void;
}

const TIER_0_READ_ONLY_TOOLS = new Set([
  "read_file",
  "list_dir",
  "glob",
  "grep",
  "git_status",
  "git_diff",
  "git_log",
  "task_list",
  "task_create",
  "task_update",
  "rollback",
  "subagent_spawn",
  "subagent_parallel",
  "process_status",
  "process_logs",
]);

const SENSITIVE_PATH_PATTERNS = [
  /^\.env(\..+)?$/i,
  /\.pem$/i,
  /\.key$/i,
  /id_rsa/i,
  /id_ed25519/i,
  /credentials\.json$/i,
  /\.aws\/credentials/i,
  /\.ssh\//i,
];

const SAFE_READ_COMMANDS = new Set([
  "ls", "dir", "pwd", "which", "where", "cat", "head", "tail",
  "echo", "git status", "git diff", "git log", "git branch", "node -v", "npm -v", "tsc --version",
]);

const DANGEROUS_COMMAND_SUBSTRINGS = [
  "rm -rf", "git reset --hard", "git clean -f", "format ", "dd ",
  "mkfs", "chmod -R", "chown -R", "curl ", "wget ", "powershell -enc",
];

export function isPathSensitive(filePath: string): boolean {
  const norm = filePath.replace(/\\/g, "/");
  const base = norm.split("/").pop() || "";
  return SENSITIVE_PATH_PATTERNS.some((pat) => pat.test(norm) || pat.test(base));
}

export function classifyBashCommand(command: string): { isSafe: boolean; tier: RiskTier } {
  const trimmed = command.trim();

  // Tier 4: Explicit dangerous commands or subshell evasions
  for (const dangerous of DANGEROUS_COMMAND_SUBSTRINGS) {
    if (trimmed.toLowerCase().includes(dangerous.toLowerCase())) {
      return { isSafe: false, tier: 4 };
    }
  }

  // Check subshell substitutions / evals / base64 pipes (UX heuristic classifier)
  if (/\$\(|`|eval\s+|base64\s+-d\s*\||\|\s*sh|\|\s*bash/i.test(trimmed)) {
    return { isSafe: false, tier: 3 };
  }

  // Check for command chains
  const subCommands = trimmed.split(/&&|\|\||;/).map((c) => c.trim()).filter(Boolean);
  let allSafe = subCommands.length > 0;

  for (const sub of subCommands) {
    const tokens = sub.split(/\s+/);
    const cmdName = tokens[0]?.toLowerCase() || "";
    const isGitRead = (cmdName === "git" && (tokens[1] === "status" || tokens[1] === "diff" || tokens[1] === "log" || tokens[1] === "branch"));
    if (!SAFE_READ_COMMANDS.has(cmdName) && !isGitRead && !SAFE_READ_COMMANDS.has(sub)) {
      allSafe = false;
      break;
    }
  }

  if (allSafe) return { isSafe: true, tier: 2 };
  return { isSafe: false, tier: 3 };
}

export function classifyToolRisk(toolName: string, input: unknown): RiskTier {
  // Check sensitive files
  if (input && typeof input === "object") {
    const pathArg = (input as Record<string, unknown>).path;
    if (typeof pathArg === "string" && isPathSensitive(pathArg)) {
      return 4;
    }
  }

  if (TIER_0_READ_ONLY_TOOLS.has(toolName)) {
    return 0;
  }

  if (toolName === "write_file" || toolName === "edit_file") {
    return 1;
  }

  if (toolName === "bash") {
    const cmd = (input as Record<string, unknown>)?.command;
    if (typeof cmd === "string") {
      return classifyBashCommand(cmd).tier;
    }
    return 3;
  }

  if (toolName.startsWith("mcp__")) {
    // MCP tools default to Tier 3 (untrusted boundary)
    return 3;
  }

  return 3;
}

export function createDeferredPermissions(
  autoApprove: Set<string>,
  initialMode: AgentMode = "code"
): DeferredPermissions {
  const approved = new Set(autoApprove);
  let currentMode: AgentMode = initialMode;
  let pending: { toolName: string; resolve: (ok: boolean) => void } | null = null;

  return {
    manager: {
      classifyRisk(toolName: string, input: unknown): RiskTier {
        return classifyToolRisk(toolName, input);
      },

      async check(toolName: string, input: unknown, source: "direct" | "subagent" | "background" | "mcp" = "direct"): Promise<boolean> {
        const tier = classifyToolRisk(toolName, input);

        // 1. Auto mode: approve everything except Tier 4 sensitive items
        if (currentMode === "auto") {
          if (tier === 4) {
            // Tier 4 sensitive operations still park for confirmation in auto mode
            const ok = await new Promise<boolean>((resolve) => {
              pending = { toolName, resolve };
            });
            logAudit({
              ts: Date.now(),
              source,
              tool: toolName,
              args: input,
              tier,
              decision: ok ? "allowed" : "denied",
            });
            return ok;
          }
          logAudit({
            ts: Date.now(),
            source,
            tool: toolName,
            args: input,
            tier,
            decision: "auto_approved",
          });
          return true;
        }

        // 2. Plan mode: allow read-only (Tier 0 and Tier 2 safe bash), deny mutating
        if (currentMode === "plan") {
          if (tier === 0 || tier === 2) {
            logAudit({
              ts: Date.now(),
              source,
              tool: toolName,
              args: input,
              tier,
              decision: "auto_approved",
            });
            return true;
          }
          logAudit({
            ts: Date.now(),
            source,
            tool: toolName,
            args: input,
            tier,
            decision: "denied",
          });
          return false;
        }

        // 3. Code mode:
        // Tier 0 and Tier 2 safe bash are auto-approved
        if (tier === 0 || tier === 2) {
          logAudit({
            ts: Date.now(),
            source,
            tool: toolName,
            args: input,
            tier,
            decision: "auto_approved",
          });
          return true;
        }

        // Check if session whitelisted
        if (approved.has(toolName) && tier < 4) {
          logAudit({
            ts: Date.now(),
            source,
            tool: toolName,
            args: input,
            tier,
            decision: "auto_approved",
          });
          return true;
        }

        // Prompt user
        const ok = await new Promise<boolean>((resolve) => {
          pending = { toolName, resolve };
        });

        logAudit({
          ts: Date.now(),
          source,
          tool: toolName,
          args: input,
          tier,
          decision: ok ? "allowed" : "denied",
        });

        return ok;
      },

      getMode(): AgentMode {
        return currentMode;
      },

      setMode(mode: AgentMode): void {
        currentMode = mode;
      },
    },

    respond(answer: "y" | "n" | "a"): void {
      if (!pending) return;
      const { toolName, resolve } = pending;
      if (answer === "a") approved.add(toolName);
      pending = null;
      resolve(answer === "y" || answer === "a");
    },

    isPending(): boolean {
      return pending !== null;
    },

    currentTool(): string | null {
      return pending?.toolName ?? null;
    },

    getMode(): AgentMode {
      return currentMode;
    },

    setMode(mode: AgentMode): void {
      currentMode = mode;
    },
  };
}
