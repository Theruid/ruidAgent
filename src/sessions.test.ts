import { describe, it } from "node:test";
import assert from "node:assert";
import {
  CURRENT_SESSION_SCHEMA_VERSION,
  migrateSession,
  titleFromMessages,
  newSessionId,
  type StoredSession,
} from "./sessions.js";
import type { LLMMessage } from "./providers/types.js";

describe("Session Schema & Migrations", () => {
  it("generates formatted session ids", () => {
    const id = newSessionId();
    assert.match(id, /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-[a-z0-9]+$/);
  });

  it("migrates v1 legacy string content messages to v2 structured blocks", () => {
    const legacyRaw = {
      id: "session-123",
      title: "Old Session",
      providerName: "anthropic",
      model: "claude-3-5-sonnet",
      messages: [
        { role: "user", content: "Hello world" },
        { role: "assistant", content: "Hi there!" },
      ],
    };

    const migrated = migrateSession(legacyRaw);

    assert.strictEqual(migrated.schemaVersion, CURRENT_SESSION_SCHEMA_VERSION);
    assert.strictEqual(migrated.id, "session-123");
    assert.strictEqual(migrated.messages.length, 2);
    assert.deepStrictEqual(migrated.messages[0].content, [{ type: "text", text: "Hello world" }]);
    assert.deepStrictEqual(migrated.messages[1].content, [{ type: "text", text: "Hi there!" }]);
  });

  it("preserves v2 structured messages without alteration", () => {
    const v2Raw: StoredSession = {
      schemaVersion: 2,
      id: "session-v2",
      title: "V2 Session",
      createdAt: 1700000000000,
      updatedAt: 1700000005000,
      providerName: "openai",
      model: "gpt-4o",
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "Run tool" }],
        },
        {
          role: "assistant",
          content: [
            {
              type: "tool_call",
              id: "call_1",
              name: "read_file",
              input: { path: "package.json" },
            },
          ],
        },
      ],
    };

    const migrated = migrateSession(v2Raw);
    assert.strictEqual(migrated.schemaVersion, 2);
    assert.strictEqual(migrated.messages.length, 2);
    assert.strictEqual(migrated.messages[1].content[0].type, "tool_call");
  });

  it("extracts session title from first user message", () => {
    const msgs: LLMMessage[] = [
      {
        role: "user",
        content: [{ type: "text", text: "Fix the broken authentication endpoint in auth.ts" }],
      },
    ];

    const title = titleFromMessages(msgs);
    assert.strictEqual(title, "Fix the broken authentication endpoint in auth.ts");

    const longMsgs: LLMMessage[] = [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "This is a very long prompt that exceeds sixty characters and should be truncated with ellipsis properly",
          },
        ],
      },
    ];
    const longTitle = titleFromMessages(longMsgs);
    assert.strictEqual(longTitle.length, 61);
    assert.strictEqual(longTitle.endsWith("…"), true);
  });
});
