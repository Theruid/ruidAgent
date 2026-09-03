import * as path from "node:path";

export type FailureClassification = "transient" | "permanent" | "stale_state";

export const STALE_STATE_SIGNATURES = [
  /old_string not found/i,
  /resource changed since last read/i,
  /conflicting version/i,
  /file modified concurrently/i,
  /target text does not match/i,
];

export function classifyToolFailure(errorMessage: string): FailureClassification {
  for (const sig of STALE_STATE_SIGNATURES) {
    if (sig.test(errorMessage)) {
      return "stale_state";
    }
  }
  return "transient";
}

/**
 * Normalizes a file/resource path to a canonical relative forward-slash format.
 */
export function normalizeResourcePath(filePath: string, workspaceRoot?: string): string {
  if (!filePath) return "";
  let unified = filePath.replace(/\\/g, "/").trim();
  if (workspaceRoot) {
    const wsUnified = workspaceRoot.replace(/\\/g, "/");
    if (unified.startsWith(wsUnified)) {
      unified = path.relative(wsUnified, unified).replace(/\\/g, "/");
    }
  }
  if (unified.startsWith("./")) {
    unified = unified.slice(2);
  }
  return path.normalize(unified).replace(/\\/g, "/");
}

export interface StaleStateTrack {
  toolName: string;
  inputJson: string;
  targetPath?: string;
  forcedReadDone: boolean;
  retriedOnce: boolean;
}
