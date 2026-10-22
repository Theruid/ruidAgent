import { describe, it } from "node:test";
import assert from "node:assert";
import * as ed from "./lineEditor.js";

const at = (value: string, cursor: number): ed.EditorState => ({ value, cursor });

describe("Line editor (lineEditor.ts)", () => {
  it("inserts and deletes at the cursor, not just at the end", () => {
    let s = at("helo world", 3);
    s = ed.insert(s, "l");
    assert.deepStrictEqual(s, at("hello world", 4));
    s = ed.backspace(s);
    assert.deepStrictEqual(s, at("helo world", 3));
    s = ed.deleteForward(s);
    assert.deepStrictEqual(s, at("hel world", 3));
    assert.deepStrictEqual(ed.backspace(at("abc", 0)), at("abc", 0));
    assert.deepStrictEqual(ed.deleteForward(at("abc", 3)), at("abc", 3));
  });

  it("moves by character without splitting emoji", () => {
    const s = at("a😀b", 1);
    assert.strictEqual(ed.right(s).cursor, 3);
    assert.strictEqual(ed.left(at("a😀b", 3)).cursor, 1);
    assert.deepStrictEqual(ed.backspace(at("a😀b", 3)), at("ab", 1));
  });

  it("jumps and deletes by word", () => {
    const s = at("git commit --amend", 18);
    assert.strictEqual(ed.wordLeft(s).cursor, 13);
    assert.strictEqual(ed.wordLeft(at("git commit --amend", 13)).cursor, 4);
    assert.strictEqual(ed.wordRight(at("git commit --amend", 0)).cursor, 3);
    assert.deepStrictEqual(ed.deleteWordBack(at("git commit --amend", 10)), at("git  --amend", 4));
  });

  it("works on the cursor's line in a multi-line draft", () => {
    const text = "first line\nsecond line\nthird";
    const s = at(text, 15); // inside "second"
    assert.strictEqual(ed.lineStart(s).cursor, 11);
    assert.strictEqual(ed.lineEnd(s).cursor, 22);
    assert.deepStrictEqual(ed.killToLineStart(s), at("first line\nnd line\nthird", 11));
    assert.deepStrictEqual(ed.killToLineEnd(s), at("first line\nseco\nthird", 15));
    assert.deepStrictEqual(ed.cursorPosition(s), { line: 1, column: 4, lineCount: 3 });
  });

  it("moves up and down between lines, keeping the column where possible", () => {
    const text = "abcdef\nxy\nlonger line";
    const up = ed.lineUp(at(text, 9)); // end of "xy"
    assert.strictEqual(up?.cursor, 2);
    const down = ed.lineDown(at(text, 5)); // column 5 of line 0 -> clamps to "xy"
    assert.strictEqual(down?.cursor, 9);
    assert.strictEqual(ed.lineUp(at(text, 1)), null);
    assert.strictEqual(ed.lineDown(at(text, text.length)), null);
  });

  it("keeps a window of lines around the cursor for long drafts", () => {
    assert.deepStrictEqual(ed.foldWindow(5, 4), { start: 0, end: 5 });
    assert.deepStrictEqual(ed.foldWindow(20, 0), { start: 0, end: 4 });
    assert.deepStrictEqual(ed.foldWindow(20, 10), { start: 8, end: 12 });
    assert.deepStrictEqual(ed.foldWindow(20, 19), { start: 16, end: 20 });
  });
});
