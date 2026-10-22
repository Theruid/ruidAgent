import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveAtFileMentions } from "./atMentions.js";

describe("@file mentions (atMentions.ts)", () => {
  let root: string;
  let outside: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "ruid-at-ws-"));
    outside = mkdtempSync(join(tmpdir(), "ruid-at-outside-"));
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "src", "app.ts"), "export const x = 1;\n");
    writeFileSync(join(root, ".env.local"), "SECRET=1\n");
    writeFileSync(join(outside, "secret.txt"), "top secret\n");
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });

  it("attaches workspace files", () => {
    const res = resolveAtFileMentions("look at @src/app.ts please", root);
    assert.ok(res.prompt.includes("--- Content of @src/app.ts ---"));
    assert.ok(res.prompt.includes("export const x = 1;"));
    assert.deepStrictEqual(res.skipped, []);
  });

  it("refuses paths that escape the workspace", () => {
    const rel = `../${outside.split(/[\\/]/).pop()}/secret.txt`;
    const res = resolveAtFileMentions(`read @${rel}`, root);
    assert.ok(!res.prompt.includes("top secret"));
    assert.deepStrictEqual(res.skipped, [{ path: rel, reason: "outside the workspace" }]);
  });

  it("refuses sensitive files such as .env variants", () => {
    const res = resolveAtFileMentions("check @sub/../.env.local", root);
    assert.ok(!res.prompt.includes("SECRET=1"));
    assert.strictEqual(res.skipped[0]?.reason, "sensitive file");
  });

  it("does not treat email addresses as mentions", () => {
    writeFileSync(join(root, "example.com"), "not a mention\n");
    const res = resolveAtFileMentions("mail me@example.com", root);
    assert.strictEqual(res.prompt, "mail me@example.com");
  });
});
