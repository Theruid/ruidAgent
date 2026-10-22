import { describe, it } from "node:test";
import assert from "node:assert";
import React from "react";
import { render } from "ink";
import { PassThrough } from "node:stream";
import { App } from "./App.js";
import { AgentUIStore } from "./store.js";
import { createFrameDiffStdout } from "./frameDiff.js";
import { VirtualScreen } from "./testing/vt.js";

/** A fake TTY that records everything written and replays it on a virtual screen. */
function fakeTerminal(rows: number, columns: number) {
  const screen = new VirtualScreen(rows, columns);
  const raw = new PassThrough() as unknown as NodeJS.WriteStream & { output: string };
  Object.assign(raw, { rows, columns, isTTY: true, output: "" });
  (raw as unknown as PassThrough).on("data", (d: Buffer) => {
    raw.output += d.toString();
    screen.write(d.toString());
  });
  const stdin = new PassThrough() as unknown as NodeJS.ReadStream;
  Object.assign(stdin, { isTTY: true, setRawMode: () => {}, ref: () => {}, unref: () => {} });
  return { raw, stdout: createFrameDiffStdout(raw), stdin, screen };
}

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));
// ansi-escapes' clearTerminal: erase display (2J), optionally scrollback (3J).
const CLEAR_SCREEN = /\x1b\[2J/;

describe("App rendering (flicker)", () => {
  it("redraws in place: no full-screen clears, no duplicated lines", async () => {
    const term = fakeTerminal(30, 100);
    const store = new AgentUIStore("deepseek", "deepseek-chat", true);
    const noop = () => {};
    const inst = render(
      React.createElement(App, {
        store,
        onSubmit: noop,
        onAbortTurn: noop,
        onExit: noop,
        onPickSession: noop,
        onSetupDone: noop,
        onPickModel: noop,
        onPickProvider: noop,
      }),
      { stdout: term.stdout, stdin: term.stdin, patchConsole: false },
    );
    try {
      await tick(200);
      // What used to flash or duplicate: typing, notices appearing, a long
      // transcript, a running tool's spinner, streamed text, a notice panel.
      term.stdin.write("hello");
      await tick(100);
      store.setNotice("Connected: deepseek");
      await tick(100);
      for (let i = 0; i < 20; i++) store.addUserMessage(`message ${i}`);
      store.beginTurn();
      store.applyLoopEvent({ type: "tool_start", name: "bash", input: { command: "npm test" }, toolCallId: "t1" });
      await tick(300);
      store.applyLoopEvent({ type: "tool_result", name: "bash", content: "ok", isError: false, toolCallId: "t1" });
      for (let i = 0; i < 5; i++) {
        store.applyLoopEvent({ type: "text_delta", text: `streamed chunk ${i} ` });
        await tick(60);
      }
      store.setNotice("Commands\n/help  show help\n/new   new chat");
      await tick(150);
      store.setNotice(null);
      store.endTurn(null);
      await tick(150);

      assert.ok(!CLEAR_SCREEN.test(term.raw.output), "a redraw cleared the whole terminal");
      assert.strictEqual(term.screen.scrollback.length, 0, "the frame scrolled the terminal");
      assert.strictEqual(term.screen.count("deepseek-chat"), 1, "status bar drawn more than once");
      assert.strictEqual(term.screen.count("╭"), 1, "input box drawn more than once");
      assert.strictEqual(term.screen.count("> hello"), 1);
    } finally {
      inst.unmount();
    }
  });
});
