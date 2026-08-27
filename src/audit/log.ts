import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { ensureConfigDir } from "../config.js";

export type AuditSource = "direct" | "subagent" | "background" | "mcp";
export type AuditDecision = "allowed" | "denied" | "auto_approved";

export interface AuditRecord {
  ts: number;
  source: AuditSource;
  tool: string;
  args?: unknown;
  tier: number;
  decision: AuditDecision;
  resultSummary?: string;
  isError?: boolean;
  error?: string;
  durationMs?: number;
}

function auditLogPath(): string {
  const dir = ensureConfigDir();
  mkdirSync(dir, { recursive: true });
  return join(dir, "audit.jsonl");
}

export function logAudit(record: AuditRecord): void {
  try {
    const file = auditLogPath();
    const line = JSON.stringify(record) + "\n";
    appendFileSync(file, line, "utf8");
  } catch {
    // Audit logging failure should not crash agent execution
  }
}
