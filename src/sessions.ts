import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import type { LLMMessage } from "./providers/types.js";
import { ensureConfigDir } from "./config.js";

export interface StoredSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  providerName: string;
  model: string;
  messages: LLMMessage[];
}

function sessionsDir(): string {
  return join(ensureConfigDir(), "sessions");
}

export function saveSession(sess: StoredSession): void {
  mkdirSync(sessionsDir(), { recursive: true });
  sess.updatedAt = Date.now();
  writeFileSync(join(sessionsDir(), `${sess.id}.json`), JSON.stringify(sess, null, 2));
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
        sessions.push({
          id: raw.id,
          title: typeof raw.title === "string" ? raw.title : "(untitled)",
          createdAt: raw.createdAt ?? 0,
          updatedAt: raw.updatedAt ?? 0,
          providerName: raw.providerName ?? "?",
          model: raw.model ?? "?",
          messages: raw.messages,
        });
      }
    } catch {
      // skip unreadable/corrupt session files
    }
  }
  return sessions.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function loadSession(id: string): StoredSession | null {
  try {
    return JSON.parse(readFileSync(join(sessionsDir(), `${id}.json`), "utf8"));
  } catch {
    return null;
  }
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
