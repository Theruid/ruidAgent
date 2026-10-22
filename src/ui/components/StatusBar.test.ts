import { describe, it } from "node:test";
import assert from "node:assert";
import { layoutStatusBar } from "./StatusBar.js";
import { filterSessions, type StoredSession } from "../../sessions.js";

const parts = {
  modeLabel: "[CODE]",
  connected: true,
  providerName: "anthropic",
  model: "claude-sonnet-4-5-20250929",
  thinkingBadge: " · [think]",
  ctx: " · ctx 42%",
  tokens: "120k in · 8.2k out",
  cached: " · 90k cached",
  cost: "~$0.41",
  latency: "3.2s",
  right: "⚡ 2 MCP · 4 skills",
};

const width = (p: ReturnType<typeof layoutStatusBar>) =>
  [`${p.mode} ${p.model}${p.ctx}`, p.usage, p.right].filter(Boolean).reduce((n, s) => n + Array.from(s).length, 0) +
  2 * ([p.usage, p.right].filter(Boolean).length);

describe("Status bar layout", () => {
  it("shows everything when there is room", () => {
    const p = layoutStatusBar(200, parts);
    assert.strictEqual(p.right, parts.right);
    assert.ok(p.usage.includes("cached") && p.usage.includes("3.2s"));
    assert.ok(p.model.includes("[think]"));
  });

  it("drops detail, least important first, to stay on one line", () => {
    for (const w of [110, 90, 70, 55, 40, 30]) {
      const p = layoutStatusBar(w, parts);
      assert.ok(width(p) <= w, `width ${width(p)} > ${w}`);
      assert.strictEqual(p.mode, "[CODE]");
    }
    const mid = layoutStatusBar(90, parts);
    assert.strictEqual(mid.right, "");
    assert.ok(mid.usage.includes("~$0.41"));
    // the cost survives even at the narrowest widths
    assert.ok(layoutStatusBar(30, parts).usage.includes("~$0.41"));
  });
});

describe("Session filtering", () => {
  const sess = (id: string, title: string, text: string): StoredSession => ({
    schemaVersion: 2,
    id,
    title,
    createdAt: 0,
    updatedAt: 0,
    providerName: "openai",
    model: "gpt-4o",
    messages: [{ role: "user", content: [{ type: "text", text }] }],
  });
  const all = [sess("a", "Fix login bug", "jwt expiry"), sess("b", "Docs", "write the README for the parser")];

  it("matches titles and message text without touching disk", () => {
    assert.deepStrictEqual(filterSessions(all, "").map((s) => s.id), ["a", "b"]);
    assert.deepStrictEqual(filterSessions(all, "login").map((s) => s.id), ["a"]);
    const byText = filterSessions(all, "parser");
    assert.deepStrictEqual(byText.map((s) => s.id), ["b"]);
    assert.ok(byText[0].snippet?.includes("parser"));
  });
});
