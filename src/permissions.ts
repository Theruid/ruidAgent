// Deferred permission manager: check() parks its resolver; the TUI surfaces
// pending requests and resolves them via respond() from a keypress. Keeps the
// PermissionManager contract so loop.ts needs no changes.
export interface PermissionManager {
  check(toolName: string, input: unknown): Promise<boolean>;
}

export interface DeferredPermissions {
  manager: PermissionManager;
  /** Resolve the currently pending request. "a" whitelists for the session. */
  respond(answer: "y" | "n" | "a"): void;
  isPending(): boolean;
  currentTool(): string | null;
}

export function createDeferredPermissions(autoApprove: Set<string>): DeferredPermissions {
  const approved = new Set(autoApprove);
  let pending: { toolName: string; resolve: (ok: boolean) => void } | null = null;

  return {
    manager: {
      async check(toolName: string, _input: unknown): Promise<boolean> {
        if (approved.has(toolName)) return true;
        return new Promise<boolean>((resolve) => {
          pending = { toolName, resolve };
        });
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
  };
}
