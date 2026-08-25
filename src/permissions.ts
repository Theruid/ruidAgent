export type AgentMode = "code" | "plan" | "auto";

// Deferred permission manager: check() parks its resolver; the TUI surfaces
// pending requests and resolves them via respond() from a keypress. Keeps the
// PermissionManager contract so loop.ts needs no changes.
export interface PermissionManager {
  check(toolName: string, input: unknown): Promise<boolean>;
  getMode(): AgentMode;
  setMode(mode: AgentMode): void;
}

export interface DeferredPermissions {
  manager: PermissionManager;
  /** Resolve the currently pending request. "a" whitelists for the session. */
  respond(answer: "y" | "n" | "a"): void;
  isPending(): boolean;
  currentTool(): string | null;
  getMode(): AgentMode;
  setMode(mode: AgentMode): void;
}

const READ_ONLY_TOOLS = new Set([
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
]);

export function createDeferredPermissions(
  autoApprove: Set<string>,
  initialMode: AgentMode = "code"
): DeferredPermissions {
  const approved = new Set(autoApprove);
  let currentMode: AgentMode = initialMode;
  let pending: { toolName: string; resolve: (ok: boolean) => void } | null = null;

  return {
    manager: {
      async check(toolName: string, _input: unknown): Promise<boolean> {
        // 1. Auto mode: bypass all permissions
        if (currentMode === "auto") return true;

        // 2. Plan mode: allow read-only and task tools, reject mutating actions
        if (currentMode === "plan") {
          if (READ_ONLY_TOOLS.has(toolName)) return true;
          // Disallow file modifications and shell executions in plan mode
          return false;
        }

        // 3. Code mode: check approved whitelist or park for prompt
        if (approved.has(toolName)) return true;
        return new Promise<boolean>((resolve) => {
          pending = { toolName, resolve };
        });
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
