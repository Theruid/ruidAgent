import { describe, it } from "node:test";
import assert from "node:assert";
import { classifyToolFailure } from "./staleState.js";

describe("Stale State Re-Verification & Retry Logic", () => {
  it("classifies old_string not found as stale_state", () => {
    const err = "old_string not found in src/example.ts. Check exact whitespace/indentation.";
    assert.strictEqual(classifyToolFailure(err), "stale_state");
  });

  it("classifies conflicting version as stale_state", () => {
    const err = "conflicting version detected on resource";
    assert.strictEqual(classifyToolFailure(err), "stale_state");
  });

  it("classifies generic errors as transient", () => {
    const err = "network timeout on endpoint";
    assert.strictEqual(classifyToolFailure(err), "transient");
  });
});
