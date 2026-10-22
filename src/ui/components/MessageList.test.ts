import { describe, it } from "node:test";
import assert from "node:assert";
import { compileLines } from "./MessageList.js";
import type { ViewMessage } from "../store.js";

const WIDTH = 80;

function texts(lines: ReturnType<typeof compileLines>): string[] {
  return lines.map((l) => l.text);
}

describe("compileLines — agent presentation", () => {
  it("labels user and agent rows with glyphs", () => {
    const messages: ViewMessage[] = [
      { id: 1, kind: "user", text: "Hi" },
      { id: 2, kind: "assistant", text: "Hello!" },
    ];
    const lines = compileLines(messages, "", WIDTH);

    const userHeader = lines.find((l) => l.kind === "user-header");
    const agentHeader = lines.find((l) => l.kind === "assistant-header");
    assert.strictEqual(userHeader?.text, "❯ you");
    assert.strictEqual(agentHeader?.text, "✦ agent");
  });

  it("streams the tail of live reasoning instead of a static placeholder", () => {
    const thought = "first thought\nsecond thought\nthird thought";
    const lines = compileLines([], "", WIDTH, thought);

    const streamingThought = lines.filter((l) => l.kind === "streaming-thought").map((l) => l.text);
    assert.deepStrictEqual(streamingThought, ["first thought", "second thought", "third thought"]);
    assert.strictEqual(lines.find((l) => l.kind === "streaming-header")?.text, "✦ agent");
  });

  it("caps live reasoning to the last four wrapped lines", () => {
    const thought = Array.from({ length: 12 }, (_, i) => `line ${i}`).join("\n");
    const lines = compileLines([], "", WIDTH, thought);
    const streamingThought = lines.filter((l) => l.kind === "streaming-thought");

    assert.strictEqual(streamingThought.length, 4);
    assert.strictEqual(streamingThought.at(-1)?.text, "line 11");
  });

  it("shows a one-line preview for completed reasoning", () => {
    const messages: ViewMessage[] = [
      {
        id: 1,
        kind: "assistant",
        text: "Done.",
        thought: "\n  I should read the config first.\nThen decide.",
        thoughtDurationMs: 1200,
      },
    ];
    const lines = compileLines(messages, "", WIDTH);

    assert.strictEqual(lines.find((l) => l.kind === "thought-body")?.text, "◦ thought for 1.2s");
    assert.strictEqual(lines.find((l) => l.kind === "thought-preview")?.text, "I should read the config first.");
  });

  it("puts the turn duration first in the receipt line", () => {
    const messages: ViewMessage[] = [
      {
        id: 1,
        kind: "assistant",
        text: "",
        turnReceipt: { filesChanged: 2, commandsRun: 1, durationMs: 65_000, costDelta: 0.004 },
      },
    ];
    const lines = compileLines(messages, "", WIDTH);
    const receipt = lines.find((l) => l.kind === "turn-receipt");

    assert.strictEqual(receipt?.text, "⚡ 1m 05s · 2 files modified · 1 command run · $0.004");
  });

  it("adds a streaming caret marker to the last streamed line", () => {
    const lines = compileLines([], "Hello world", WIDTH);
    const body = lines.filter((l) => l.kind === "streaming-body");
    assert.ok(body.length > 0);
    assert.ok(body.at(-1)!.text.endsWith("▌"));
  });

  it("attaches the live indicator to the agent line while running", () => {
    const live = {
      running: true,
      action: { name: "Generating answer", startedAt: 1000 },
      turnStartedAt: 900,
    };
    const lines = compileLines([{ id: 1, kind: "user", text: "Hi" }], "", WIDTH, undefined, undefined, live);

    const header = lines.find((l) => l.kind === "streaming-header");
    assert.ok(header);
    assert.strictEqual(header.text, "✦ agent");
    assert.strictEqual(header.activity?.action.name, "Generating answer");
    assert.strictEqual(header.activity?.columns, WIDTH);
  });

  it("shows the agent line before any token arrives", () => {
    const live = { running: true, action: null, turnStartedAt: 900 };
    const lines = compileLines([{ id: 1, kind: "user", text: "Hi" }], "", WIDTH, undefined, undefined, live);

    assert.ok(lines.some((l) => l.kind === "streaming-header"));
    assert.ok(lines.some((l) => l.kind === "user-body" && l.text === "Hi"));
  });

  it("does not duplicate the indicator while a tool row is pending", () => {
    const messages: ViewMessage[] = [
      { id: 1, kind: "user", text: "Hi" },
      {
        id: 2,
        kind: "tool",
        text: "",
        toolName: "bash",
        pending: true,
        toolMeta: { badgeTitle: "bash", badgeDetail: "npm test" },
      },
    ];
    const lines = compileLines(messages, "", WIDTH, undefined, undefined, {
      running: true,
      action: { name: "Running bash", detail: "npm test", startedAt: 1000 },
      turnStartedAt: 900,
    });

    assert.strictEqual(lines.some((l) => l.kind === "streaming-header"), false);
    assert.ok(lines.some((l) => l.kind === "tool-pending"));
  });

  it("renders exactly one agent header per turn, even across tool calls", () => {
    const messages: ViewMessage[] = [
      { id: 1, kind: "user", text: "check the news" },
      { id: 2, kind: "assistant", text: "Let me look." },
      { id: 3, kind: "tool", text: "ok", toolName: "web_fetch", toolMeta: { badgeTitle: "web_fetch" } },
      { id: 4, kind: "assistant", text: "Here is the news." },
    ];
    const lines = compileLines(messages, "", WIDTH);

    assert.strictEqual(lines.filter((l) => l.kind === "assistant-header").length, 1);
    // A second user turn gets its own header again.
    const twoTurns = compileLines(
      [...messages, { id: 5, kind: "user", text: "and again" }, { id: 6, kind: "assistant", text: "Sure." }],
      "",
      WIDTH,
    );
    assert.strictEqual(twoTurns.filter((l) => l.kind === "assistant-header").length, 2);
  });

  it("opens the turn with the agent header, above tool rows", () => {
    const fetchTool: ViewMessage = {
      id: 2,
      kind: "tool",
      text: "ok",
      toolName: "web_fetch",
      toolMeta: { badgeTitle: "web_fetch" },
    };
    const messages: ViewMessage[] = [
      { id: 1, kind: "user", text: "news?" },
      fetchTool,
      { ...fetchTool, id: 3 },
      { ...fetchTool, id: 4 },
      { id: 5, kind: "assistant", text: "Here are the headlines." },
    ];
    const lines = compileLines(messages, "", WIDTH);

    const headerIdx = lines.findIndex((l) => l.kind === "assistant-header");
    const groupIdx = lines.findIndex((l) => l.kind === "tool-success");
    const textIdx = lines.findIndex((l) => l.kind === "assistant-body");

    assert.ok(headerIdx > 0, "header should open the turn");
    assert.ok(headerIdx < groupIdx, "header must sit above the explored-files line");
    assert.ok(groupIdx < textIdx, "the answer text comes after the tools");
  });

  it("drops the agent label from the live line once the header is shown", () => {
    const lines = compileLines([{ id: 1, kind: "user", text: "Hi" }], "", WIDTH, undefined, undefined, {
      running: true,
      action: { name: "Reviewing results", detail: "bash", startedAt: 1000 },
      turnStartedAt: 900,
      headerShown: true,
    });

    const header = lines.find((l) => l.kind === "streaming-header");
    assert.ok(header);
    assert.strictEqual(header.text, "");
    assert.strictEqual(header.activity?.action.name, "Reviewing results");
  });

  it("drops the live indicator when a pending tool row already reports progress", () => {
    const lines = compileLines([{ id: 1, kind: "user", text: "Hi" }], "", WIDTH, undefined, undefined, {
      running: true,
      action: { name: "Running bash", detail: "npm test", startedAt: 1000 },
      turnStartedAt: 900,
      suppress: true,
    });
    assert.strictEqual(lines.some((l) => l.kind === "streaming-header"), false);
  });

  it("drops the live indicator once the turn ends", () => {
    const lines = compileLines([{ id: 1, kind: "user", text: "Hi" }], "", WIDTH, undefined, undefined, {
      running: false,
      action: null,
      turnStartedAt: 0,
    });
    assert.strictEqual(lines.some((l) => l.kind === "streaming-header"), false);
  });
  it("shows an expanded tool's output and keeps it out of collapsed groups", () => {
    const tool = (id: number, name: string, output: string): ViewMessage => ({
      id,
      kind: "tool",
      text: output,
      toolName: name,
      toolMeta: { badgeTitle: name, output },
    });
    const messages: ViewMessage[] = [
      { id: 1, kind: "user", text: "look" },
      tool(2, "read_file", "one"),
      tool(3, "grep", "two"),
      tool(4, "glob", "three\nfour"),
    ];
    const collapsed = compileLines(messages, "", WIDTH);
    assert.ok(collapsed.some((l) => l.text.startsWith("✔ Explored · ")));
    assert.ok(!collapsed.some((l) => l.kind === "tool-output"));

    const expanded = compileLines(messages, "", WIDTH, undefined, undefined, undefined, 4);
    const out = expanded.filter((l) => l.kind === "tool-output").map((l) => l.text);
    assert.deepStrictEqual(out, ["│ three", "│ four", "└ Ctrl+O to collapse"]);
    // the expanded row is no longer folded into the group
    assert.ok(expanded.some((l) => l.kind === "tool-success" && l.text.includes("glob")));
  });
});
