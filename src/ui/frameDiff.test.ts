import { describe, it } from "node:test";
import assert from "node:assert";
import ansiEscapes from "ansi-escapes";
import { FrameDiffer } from "./frameDiff.js";
import { VirtualScreen } from "./testing/vt.js";

/**
 * Mimics Ink's standard log-update: each frame erases the previous frame's
 * lines (including the trailing empty one) and prints the new frame.
 */
class InkLikeWriter {
  private previousLineCount = 0;
  constructor(private readonly write: (s: string) => void) {}
  frame(lines: string[]): void {
    const str = lines.join("\n") + "\n";
    this.write(ansiEscapes.eraseLines(this.previousLineCount) + str);
    this.previousLineCount = str.split("\n").length;
  }
  clear(): void {
    this.write(ansiEscapes.eraseLines(this.previousLineCount));
    this.previousLineCount = 0;
  }
  raw(s: string): void {
    this.write(s);
  }
}

/** Runs the same writes against a plain screen and a diffed one. */
function pair(rows = 12, columns = 40) {
  const plain = new VirtualScreen(rows, columns);
  const diffed = new VirtualScreen(rows, columns);
  let diffedBytes = 0;
  let plainBytes = 0;
  const differ = new FrameDiffer((s) => {
    diffedBytes += s.length;
    diffed.write(s);
  });
  const a = new InkLikeWriter((s) => {
    plainBytes += s.length;
    plain.write(s);
  });
  const b = new InkLikeWriter((s) => differ.write(s));
  const both = {
    frame: (lines: string[]) => (a.frame(lines), b.frame(lines)),
    clear: () => (a.clear(), b.clear()),
    raw: (s: string) => (a.raw(s), b.raw(s)),
  };
  return { plain, diffed, both, bytes: () => ({ plainBytes, diffedBytes }) };
}

const frame = (n: number, tag: string) => Array.from({ length: n }, (_, i) => `${tag} line ${i}`);

describe("FrameDiffer", () => {
  it("draws the same screen as full redraws while writing far less", () => {
    const { plain, diffed, both, bytes } = pair();
    const base = frame(8, "a");
    both.frame(base);
    for (let i = 0; i < 20; i++) {
      const next = [...base];
      next[6] = `spinner ${"⠋⠙⠹⠸"[i % 4]} ${i}`;
      both.frame(next);
      assert.deepStrictEqual(diffed.lines(), plain.lines());
    }
    const { plainBytes, diffedBytes } = bytes();
    assert.ok(diffedBytes < plainBytes / 3, `${diffedBytes} vs ${plainBytes}`);
  });

  it("handles frames growing and shrinking", () => {
    const { plain, diffed, both } = pair();
    for (const n of [3, 7, 2, 9, 1, 5]) {
      both.frame(frame(n, `n${n}`));
      assert.deepStrictEqual(diffed.lines(), plain.lines(), `after a ${n}-line frame`);
    }
  });

  it("keeps console output written between frames (Ink's patched console)", () => {
    const { plain, diffed, both } = pair();
    const f = frame(4, "ui");
    both.frame(f);
    // Ink's writeToStdout: clear, write the data, re-send the same frame.
    both.clear();
    both.raw("console says hi\n");
    both.frame(f);
    both.frame([...f.slice(0, 3), "ui changed"]);
    assert.deepStrictEqual(diffed.lines(), plain.lines());
    assert.strictEqual(diffed.count("console says hi"), 1);
  });

  it("recovers a fresh frame drawn after a resize clear", () => {
    const { plain, diffed, both } = pair();
    both.frame(frame(5, "wide"));
    // Ink's resized(): clear, then a new (different) frame with no erase prefix.
    both.clear();
    both.frame(frame(5, "narrow"));
    both.frame([...frame(4, "narrow"), "narrow edited"]);
    assert.deepStrictEqual(diffed.lines(), plain.lines());
  });

  it("falls back to passthrough on output it cannot follow", () => {
    const { plain, diffed, both } = pair();
    both.frame(frame(3, "x"));
    both.raw("stray write without a clear\n");
    for (const n of [4, 2]) both.frame(frame(n, `y${n}`));
    assert.deepStrictEqual(diffed.lines(), plain.lines());
  });
});
