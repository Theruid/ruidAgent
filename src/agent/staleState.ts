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

export interface StaleStateTrack {
  toolName: string;
  inputJson: string;
  targetPath?: string;
  forcedReadDone: boolean;
  retriedOnce: boolean;
}
