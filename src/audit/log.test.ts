import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import { existsSync, readFileSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { logAudit, type AuditRecord } from "./log.js";
import { ensureConfigDir } from "../config.js";

describe("Audit Logging", () => {
  const auditFile = join(ensureConfigDir(), "audit.jsonl");

  beforeEach(() => {
    try {
      if (existsSync(auditFile)) {
        rmSync(auditFile);
      }
    } catch {
      // ignore
    }
  });

  it("appends structured audit record to audit.jsonl", () => {
    const record: AuditRecord = {
      ts: 1700000000000,
      source: "direct",
      tool: "edit_file",
      args: { path: "src/index.ts" },
      tier: 1,
      decision: "allowed",
      resultSummary: "file edited successfully",
      durationMs: 45,
    };

    logAudit(record);

    assert.strictEqual(existsSync(auditFile), true);
    const content = readFileSync(auditFile, "utf8");
    const parsed = JSON.parse(content.trim()) as AuditRecord;

    assert.strictEqual(parsed.source, "direct");
    assert.strictEqual(parsed.tool, "edit_file");
    assert.strictEqual(parsed.tier, 1);
    assert.strictEqual(parsed.decision, "allowed");
    assert.strictEqual(parsed.durationMs, 45);
  });

  it("handles multi-record sequential appends", () => {
    logAudit({
      ts: 1700000000001,
      source: "mcp",
      tool: "mcp__github__search_issues",
      tier: 3,
      decision: "auto_approved",
    });

    logAudit({
      ts: 1700000000002,
      source: "subagent",
      tool: "bash",
      tier: 3,
      decision: "denied",
      error: "user denied execution",
    });

    const lines = readFileSync(auditFile, "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));

    assert.strictEqual(lines.length, 2);
    assert.strictEqual(lines[0].source, "mcp");
    assert.strictEqual(lines[1].source, "subagent");
    assert.strictEqual(lines[1].decision, "denied");
  });
});
