import { logAudit } from "./audit/log.js";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

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
  "task_delete",
  "rollback",
  "subagent_spawn",
  "subagent_parallel",
  "web_search",
  "web_fetch",
  "process_status",
  "process_logs",
  "memory_store",
  "memory_recall",
  "memory_list",
  "memory_forget",
  "skill_run",
]);

const SENSITIVE_PATH_PATTERNS = [
  /(?:^|[/\\])\.env(?:\..+)?$/i,
  /\.pem$/i,
  /\.key$/i,
  /id_rsa(?:\.pub)?$/i,
  /id_ed25519(?:\.pub)?$/i,
  /id_ecdsa(?:\.pub)?$/i,
  /id_dsa(?:\.pub)?$/i,
  /(?:^|[/\\])credentials(?:\.json)?$/i,
  /(?:^|[/\\])\.aws[/\\]credentials/i,
  /(?:^|[/\\])\.ssh[/\\]/i,
  /(?:^|[/\\])\.npmrc$/i,
  /(?:^|[/\\])\.netrc$/i,
  /(?:^|[/\\])\.git-credentials$/i,
  /\.p12$/i,
  /\.pfx$/i,
  /(?:^|[/\\])secrets(?:\..+)?$/i,
];

const TIER_4_DESTRUCTIVE_PATTERNS = [
  /\brm\s+-[a-z]*r[a-z]*f\b/i,
  /\brm\s+-[a-z]*f[a-z]*r\b/i,
  /\bdd\b/i,
  /\bmkfs\b/i,
  /\bformat\s+[a-z]:/i,
  /\bshred\b/i,
  /\btruncate\b/i,
  /\bchmod\s+-[a-z]*R/i,
  /\bchown\s+-[a-z]*R/i,
  /\bsudo\b/i,
  /\bsu\s+/i,
  /\bdoas\b/i,
  /\bnpm\s+publish\b/i,
  /\byarn\s+publish\b/i,
  /\bpnpm\s+publish\b/i,
  /\bdocker\s+system\s+prune\b/i,
  /\bkubectl\s+delete\b/i,
  /\bterraform\s+destroy\b/i,
  /\bterraform\s+apply\b/i,
  /\bpowershell\s+.*-enc/i,
  /\bpwsh\s+.*-enc/i,
  /\bStop-Process\b/i,
  /\bRemove-Item\s+.*-Recurse/i,
  /\brd\s+\/s/i,
  /\bdel\s+\/s/i,
];

const DANGEROUS_GIT_SUBCOMMANDS = new Set([
  "push",
  "clean",
  "reset",
  "restore",
  "checkout",
  "stash",
]);

const DANGEROUS_GIT_FLAGS = [
  "--output",
  "-c",
  "--exec",
  "--git-dir",
  "--work-tree",
  "-C",
];

const SAFE_READ_BINARIES = new Set([
  "pwd",
  "dir",
  "ls",
  "whoami",
  "which",
  "where",
  "node",
  "npm",
  "tsc",
  "git",
]);

export function isPathSensitive(filePath: string): boolean {
  if (!filePath) return false;
  const norm = filePath.replace(/\\/g, "/");
  const base = norm.split("/").pop() || "";
  return SENSITIVE_PATH_PATTERNS.some((pat) => pat.test(norm) || pat.test(base));
}

/**
 * Redacts well-known secret patterns before persisting records.
 */
export function redactSecrets(raw: string): string {
  if (!raw || typeof raw !== "string") return raw;
  return raw
    // AWS Access Key
    .replace(/\b(AKIA[0-9A-Z]{16})\b/g, "[REDACTED_AWS_KEY]")
    // GitHub Personal Access Tokens
    .replace(/\b(gh[pousr]_[A-Za-z0-9_]{36,})\b/g, "[REDACTED_GITHUB_TOKEN]")
    // Anthropic API Keys
    .replace(/\b(sk-ant-[a-zA-Z0-9_-]{32,})\b/g, "[REDACTED_ANTHROPIC_KEY]")
    // OpenAI API Keys
    .replace(/\b(sk-[a-zA-Z0-9]{32,})\b/g, "[REDACTED_OPENAI_KEY]")
    // Generic Bearer / JWT Tokens
    .replace(/eyJ[a-zA-Z0-9_-]{10,}\.eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/g, "[REDACTED_JWT]")
    // Private Key Blocks
    .replace(/-----BEGIN [A-Z ]+ PRIVATE KEY-----[\s\S]*?-----END [A-Z ]+ PRIVATE KEY-----/g, "[REDACTED_PRIVATE_KEY]");
}

export function classifyBashCommand(command: string): { isSafe: boolean; tier: RiskTier; reason?: string } {
  const trimmed = command.trim();
  if (!trimmed) return { isSafe: true, tier: 2 };

  // 1. Check for explicit Tier 4 dangerous commands
  for (const pat of TIER_4_DESTRUCTIVE_PATTERNS) {
    if (pat.test(trimmed)) {
      return { isSafe: false, tier: 4, reason: `Matches high-risk destructive command pattern: ${pat.source}` };
    }
  }

  // 2. Check for shell redirection operators, subshells, substitutions, chaining
  const hasShellMetacharacters = /[;&|`]|\$\(|\$\{|\n|\r|<|>|>>|&>|<<|\beval\b|\bexec\b|\bxargs\b|\bsudo\b|\bnohup\b|\btime\b/i.test(trimmed);
  if (hasShellMetacharacters) {
    return { isSafe: false, tier: 3, reason: "Command contains shell chaining, pipes, subshells, or redirection" };
  }

  // 3. Tokenize simple single command
  const tokens = trimmed.split(/\s+/).filter(Boolean);
  const binary = tokens[0]?.toLowerCase() || "";
  const args = tokens.slice(1);

  // Check if binary targets sensitive paths directly in arguments
  for (const arg of args) {
    if (isPathSensitive(arg)) {
      return { isSafe: false, tier: 4, reason: `Command targets sensitive credential file: ${arg}` };
    }
  }

  // 4. Git specific analysis
  if (binary === "git") {
    // Check for dangerous configuration/execution flags
    const hasDangerousFlag = args.some((a) => DANGEROUS_GIT_FLAGS.some((df) => a === df || a.startsWith(`${df}=`)));
    if (hasDangerousFlag) {
      return { isSafe: false, tier: 3, reason: "Git command contains configuration or output redirection flags" };
    }

    const sub = args[0]?.toLowerCase();
    if (!sub) return { isSafe: true, tier: 2 };

    if (DANGEROUS_GIT_SUBCOMMANDS.has(sub)) {
      if (sub === "branch") {
        if (args.includes("-D") || args.includes("-d") || args.includes("-m")) {
          return { isSafe: false, tier: 4, reason: "Git branch deletion or rename" };
        }
        return { isSafe: true, tier: 2 };
      }
      return { isSafe: false, tier: 4, reason: `Git operation '${sub}' modifies working tree or remote history` };
    }

    if (sub === "status" || sub === "diff" || sub === "log" || sub === "show" || sub === "rev-parse" || sub === "branch") {
      return { isSafe: true, tier: 2 };
    }

    return { isSafe: false, tier: 3, reason: `Git '${sub}' requires manual authorization` };
  }

  // 5. Version checks for developer runtimes (e.g. node -v, npm -v, tsc --version)
  if ((binary === "node" || binary === "npm" || binary === "tsc") && (args.includes("-v") || args.includes("--version") || args.includes("-version"))) {
    return { isSafe: true, tier: 2 };
  }

  // 6. Safe read allowlist
  if (SAFE_READ_BINARIES.has(binary) && binary !== "node" && binary !== "npm" && binary !== "tsc" && binary !== "git") {
    return { isSafe: true, tier: 2 };
  }

  return { isSafe: false, tier: 3, reason: `Command '${binary}' requires manual confirmation` };
}

export function classifyToolRisk(toolName: string, input: unknown): RiskTier {
  // Check sensitive files
  if (input && typeof input === "object") {
    const rec = input as Record<string, unknown>;
    const pathArg = rec.path || rec.file || rec.filePath;
    if (typeof pathArg === "string" && isPathSensitive(pathArg)) {
      return 4;
    }
    const patternArg = rec.pattern;
    if (typeof patternArg === "string" && isPathSensitive(patternArg)) {
      return 4;
    }
  }

  if (toolName === "bash") {
    const cmd = (input as Record<string, unknown>)?.command;
    if (typeof cmd === "string") {
      return classifyBashCommand(cmd).tier;
    }
    return 3;
  }

  if (TIER_0_READ_ONLY_TOOLS.has(toolName)) {
    return 0;
  }

  if (toolName === "write_file" || toolName === "edit_file") {
    return 1;
  }

  if (toolName.startsWith("mcp__")) {
    return 3;
  }

  return 3;
}

/**
 * Workspace trust database verification
 */
export function isWorkspaceTrusted(workspaceRoot: string): boolean {
  try {
    const trustFile = join(homedir(), ".ruid", "trusted_workspaces.json");
    if (!existsSync(trustFile)) return false;
    const raw = JSON.parse(readFileSync(trustFile, "utf8"));
    const hash = Buffer.from(workspaceRoot).toString("base64url");
    return Boolean(raw[hash]?.trusted);
  } catch {
    return false;
  }
}

export function setWorkspaceTrusted(workspaceRoot: string, trusted = true): void {
  try {
    const dir = join(homedir(), ".ruid");
    mkdirSync(dir, { recursive: true });
    const trustFile = join(dir, "trusted_workspaces.json");
    let data: Record<string, { trusted: boolean; timestamp: number }> = {};
    if (existsSync(trustFile)) {
      try {
        data = JSON.parse(readFileSync(trustFile, "utf8"));
      } catch {}
    }
    const hash = Buffer.from(workspaceRoot).toString("base64url");
    data[hash] = { trusted, timestamp: Date.now() };
    writeFileSync(trustFile, JSON.stringify(data, null, 2), "utf8");
  } catch {}
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
