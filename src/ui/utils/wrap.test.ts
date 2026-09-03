import { describe, it } from "node:test";
import assert from "node:assert";
import { wrapText } from "./wrap.js";

describe("Text Wrapping Utility (wrap.ts)", () => {
  it("handles empty or falsy strings", () => {
    assert.deepStrictEqual(wrapText("", 40), [""]);
  });

  it("leaves lines shorter than width intact", () => {
    const text = "Short line";
    const res = wrapText(text, 20);
    assert.deepStrictEqual(res, ["Short line"]);
  });

  it("wraps lines at word boundaries", () => {
    const text = "The quick brown fox jumps over the lazy dog";
    const res = wrapText(text, 15);
    for (const line of res) {
      assert.ok(line.length <= 15, `Line exceeded 15 chars: "${line}"`);
    }
    assert.strictEqual(res.join(" "), "The quick brown fox jumps over the lazy dog");
  });

  it("handles hard cuts when a single word exceeds width", () => {
    const text = "supercalifragilisticexpialidocious is a very long word";
    const res = wrapText(text, 12);
    assert.ok(res.length > 1);
    assert.strictEqual(res[0], "supercalifra");
  });

  it("preserves explicit line breaks", () => {
    const text = "Line 1\nLine 2\r\nLine 3";
    const res = wrapText(text, 30);
    assert.deepStrictEqual(res, ["Line 1", "Line 2", "Line 3"]);
  });

  it("enforces minimum width of 10 chars", () => {
    const text = "Hello world from ruid";
    const res = wrapText(text, 3);
    assert.ok(res[0].length <= 10);
  });
});
