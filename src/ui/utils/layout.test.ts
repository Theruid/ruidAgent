import { describe, it } from "node:test";
import assert from "node:assert";
import { inputBoxRows, permissionPromptRows, taskPanelRows, textRows } from "./layout.js";
import { popUserTurns } from "./history.js";
import { printableInput } from "../components/InputBox.js";
import type { AgentTask } from "../../tools/tasks.js";
import type { LLMMessage } from "../../providers/types.js";

const task = (id: number, status: AgentTask["status"]): AgentTask =>
  ({ id: String(id), subject: `task ${id}`, status }) as AgentTask;

describe("Layout heights (layout.ts)", () => {
  it("counts wrapped and multi-line notices", () => {
    assert.strictEqual(textRows("short", 40), 1);
    assert.strictEqual(textRows("a\nb\nc", 40), 3);
    assert.strictEqual(textRows("word ".repeat(30).trim(), 40), 4);
  });

  it("sizes the input box from the live draft, folding long drafts", () => {
    assert.strictEqual(inputBoxRows("", 80, null, 0), 3);
    assert.strictEqual(inputBoxRows("a\nb\nc", 80, null, 0), 5);
    // 10 lines fold into first two + pill + last
    assert.strictEqual(inputBoxRows(Array(10).fill("x").join("\n"), 80, null, 0), 6);
    // a single long line wraps
    assert.ok(inputBoxRows("x ".repeat(100), 40, null, 0) > 3);
    // palettes sit above the box
    assert.strictEqual(inputBoxRows("/", 80, "command", 20), 3 + 3 + 6);
    assert.strictEqual(inputBoxRows("@zz", 80, "file", 0), 3 + 3);
  });

  it("sizes the permission prompt from its diff or command", () => {
    const plain = permissionPromptRows({ toolName: "web_fetch", argsPreview: "https://x" }, 100);
    assert.strictEqual(plain, 4);
    const write = permissionPromptRows(
      { toolName: "write_file", input: { path: "new-file-for-layout-test.txt", content: "1\n2\n3" } },
      100,
    );
    // border + header + footer, then diff box (2) + new-file header + 3 added lines
    assert.strictEqual(write, 4 + 2 + 4);
    const bash = permissionPromptRows({ toolName: "bash", input: { command: "npm test" } }, 100);
    assert.strictEqual(bash, 4 + 3);
  });

  it("sizes the task panel, including the finished state", () => {
    assert.strictEqual(taskPanelRows([]), 0);
    assert.strictEqual(taskPanelRows([task(1, "completed")]), 4);
    assert.strictEqual(taskPanelRows([task(1, "in_progress"), task(2, "pending")]), 6);
    const many = Array.from({ length: 9 }, (_, i) => task(i + 1, i === 4 ? "in_progress" : "pending"));
    // 5 visible + "earlier" and "more" indicators
    assert.strictEqual(taskPanelRows(many), 4 + 5 + 2);
  });
});

describe("InputBox paste handling", () => {
  it("keeps line breaks in pasted text", () => {
    assert.strictEqual(printableInput("line1\r\nline2\nline3"), "line1\nline2\nline3");
    assert.strictEqual(printableInput("a\tb"), "a  b");
  });

  it("drops control characters from single keystrokes", () => {
    assert.strictEqual(printableInput("x"), "x");
    assert.strictEqual(printableInput("\x07"), "");
  });
});

describe("Conversation rollback (history.ts)", () => {
  const user = (text: string): LLMMessage => ({ role: "user", content: [{ type: "text", text }] });
  const assistant = (text: string): LLMMessage => ({ role: "assistant", content: [{ type: "text", text }] });
  const results: LLMMessage = {
    role: "user",
    content: [{ type: "tool_result", toolCallId: "c1", content: "ok", isError: false }],
  };

  it("pops whole turns, skipping tool-result messages, and returns the earliest prompt", () => {
    const history = [user("one"), assistant("a1"), user("two"), assistant("calls"), results, assistant("a2"), user("three"), assistant("a3")];
    assert.strictEqual(popUserTurns(history, 2), "two");
    assert.deepStrictEqual(history, [user("one"), assistant("a1")]);
  });

  it("stops when history runs out", () => {
    const history = [user("one"), assistant("a1")];
    assert.strictEqual(popUserTurns(history, 5), "one");
    assert.deepStrictEqual(history, []);
  });
});
