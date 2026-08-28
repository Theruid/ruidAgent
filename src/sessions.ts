import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync, renameSync } from "node:fs";
import { join } from "node:path";
import type { LLMMessage } from "./providers/types.js";
import { ensureConfigDir } from "./config.js";

export const CURRENT_SESSION_SCHEMA_VERSION = 2;

export interface StoredSession {
  schemaVersion: number;
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  providerName: string;
  model: string;
  messages: LLMMessage[];
  metadata?: Record<string, unknown>;
}

function sessionsDir(): string {
  return join(ensureConfigDir(), "sessions");
}

export function migrateSession(raw: any): StoredSession {
  const version = typeof raw?.schemaVersion === "number" ? raw.schemaVersion : 1;

  let session: StoredSession = {
    schemaVersion: CURRENT_SESSION_SCHEMA_VERSION,
    id: typeof raw?.id === "string" ? raw.id : newSessionId(),
    title: typeof raw?.title === "string" ? raw.title : "(untitled)",
    createdAt: typeof raw?.createdAt === "number" ? raw.createdAt : Date.now(),
    updatedAt: typeof raw?.updatedAt === "number" ? raw.updatedAt : Date.now(),
    providerName: typeof raw?.providerName === "string" ? raw.providerName : "?",
    model: typeof raw?.model === "string" ? raw.model : "?",
    messages: Array.isArray(raw?.messages) ? raw.messages : [],
    metadata: typeof raw?.metadata === "object" && raw.metadata !== null ? raw.metadata : {},
  };

  if (version === 1) {
    // Migration v1 -> v2: Ensure every message has valid content blocks
    session.messages = session.messages.map((m: any) => {
      if (typeof m?.content === "string") {
        return { role: m.role, content: [{ type: "text", text: m.content }] };
      }
      return m;
    });
  }

  // Crash Recovery: If last message is an assistant tool_call with no following tool_result,
  // append synthetic interrupted tool_result to recover clean conversation state
  const lastMsg = session.messages.at(-1);
  if (lastMsg?.role === "assistant") {
    const toolCalls = lastMsg.content.filter((c): c is Extract<typeof c, { type: "tool_call" }> => c.type === "tool_call");
    if (toolCalls.length > 0) {
      session.messages.push({
        role: "user",
        content: toolCalls.map((tc) => ({
          type: "tool_result" as const,
          toolCallId: tc.id,
          content: "Execution interrupted: process terminated unexpectedly before tool completion.",
          isError: true,
        })),
      });
    }
  }

  return session;
}

export function saveSession(sess: Omit<StoredSession, "schemaVersion"> & { schemaVersion?: number }): void {
  mkdirSync(sessionsDir(), { recursive: true });
  const fullSession: StoredSession = {
    ...sess,
    schemaVersion: CURRENT_SESSION_SCHEMA_VERSION,
    updatedAt: Date.now(),
  };
  const targetFile = join(sessionsDir(), `${fullSession.id}.json`);
  const tempFile = join(sessionsDir(), `${fullSession.id}.json.tmp`);
  writeFileSync(tempFile, JSON.stringify(fullSession, null, 2), "utf8");
  renameSync(tempFile, targetFile);
}

export function deleteSession(id: string): void {
  const file = join(sessionsDir(), `${id}.json`);
  if (existsSync(file)) unlinkSync(file);
}

export function listSessions(): StoredSession[] {
  let files: string[] = [];
  try {
    files = readdirSync(sessionsDir()).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
  const sessions: StoredSession[] = [];
  for (const f of files) {
    try {
      const raw = JSON.parse(readFileSync(join(sessionsDir(), f), "utf8"));
      if (typeof raw?.id === "string" && Array.isArray(raw?.messages)) {
        sessions.push(migrateSession(raw));
      }
    } catch {
      // skip unreadable/corrupt session files
    }
  }
  return sessions.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function loadSession(id: string): StoredSession | null {
  try {
    const raw = JSON.parse(readFileSync(join(sessionsDir(), `${id}.json`), "utf8"));
    return migrateSession(raw);
  } catch {
    return null;
  }
}

export function searchSessions(query: string): Array<StoredSession & { snippet?: string }> {
  const q = query.toLowerCase().trim();
  if (!q) return listSessions();

  const sessions = listSessions();
  const matched: Array<StoredSession & { snippet?: string }> = [];

  for (const sess of sessions) {
    if (sess.title.toLowerCase().includes(q) || sess.id.toLowerCase().includes(q)) {
      matched.push(sess);
      continue;
    }

    let foundSnippet = "";
    for (const m of sess.messages) {
      for (const c of m.content) {
        if (c.type === "text" && c.text.toLowerCase().includes(q)) {
          const idx = c.text.toLowerCase().indexOf(q);
          const start = Math.max(0, idx - 25);
          const end = Math.min(c.text.length, idx + q.length + 25);
          foundSnippet = (start > 0 ? "…" : "") + c.text.slice(start, end).replace(/\s+/g, " ").trim() + (end < c.text.length ? "…" : "");
          break;
        } else if (c.type === "tool_call" && c.name.toLowerCase().includes(q)) {
          foundSnippet = `Tool: ${c.name}`;
          break;
        }
      }
      if (foundSnippet) break;
    }

    if (foundSnippet) {
      matched.push({ ...sess, snippet: foundSnippet });
    }
  }

  return matched;
}

export function newSessionId(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const rand = Math.random().toString(36).slice(2, 6);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}-${rand}`;
}

export function titleFromMessages(messages: LLMMessage[]): string {
  const firstUser = messages.find((m) => m.role === "user");
  const text =
    firstUser?.content.find((c): c is Extract<typeof c, { type: "text" }> => c.type === "text")
      ?.text ?? "";
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return "(untitled)";
  return clean.length > 60 ? clean.slice(0, 60) + "…" : clean;
}
