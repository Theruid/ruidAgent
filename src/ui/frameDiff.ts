/**
 * Flicker-free output for Ink on Windows consoles.
 *
 * Ink's standard renderer redraws every frame by erasing all of its lines and
 * printing the whole frame again. That is correct, but cmd/PowerShell
 * (conhost) shows the erase before the reprint, so the screen blinks on every
 * keystroke and spinner tick. Ink's own `incrementalRendering` option is
 * meant to fix this, but in non-fullscreen mode it moves the cursor up one
 * row too few, leaving stale duplicate lines behind.
 *
 * This wraps stdout and turns Ink's "erase N lines + full frame" writes into
 * "move to the frame's top and rewrite only the lines that changed". The
 * screen ends up byte-for-byte what Ink intended; only fewer cells change.
 * Anything it does not recognise passes through untouched, and once it sees
 * output it cannot follow it falls back to plain passthrough for good.
 */

const ESC = "\x1b[";
const ERASE_LINE = `${ESC}2K`;
const CURSOR_UP_1 = `${ESC}1A`;
const CURSOR_LEFT = `${ESC}G`;
/** ansi-escapes eraseLines(n): (eraseLine + cursorUp) × (n-1), eraseLine, cursorLeft. */
const ERASE_PREFIX = /^((?:\x1b\[2K\x1b\[1A)*\x1b\[2K\x1b\[G)/;
/** Writes made only of escape sequences that do not move the cursor or print. */
const CONTROL_ONLY = /^(?:\x1b\[\?[0-9;]*[hl])+$/;

export class FrameDiffer {
  /** Visible lines of the frame on screen; the cursor sits on the row below it. */
  private screen: string[] | null = null;
  /** Last frame Ink drew — it re-sends exactly this after console output. */
  private lastFrame = "";
  /**
   * Written raw right after a clear without being recognised. If Ink's next
   * write is an erase+frame, this was a frame (e.g. redrawn after a resize);
   * if it is the old frame re-sent, this was console output.
   */
  private candidate: string | null = null;
  private passthrough = false;

  constructor(private readonly out: (chunk: string) => void) {}

  write(chunk: string): void {
    if (this.passthrough) return this.out(chunk);

    const erase = ERASE_PREFIX.exec(chunk);
    if (erase) {
      const rest = chunk.slice(erase[0].length);
      if (rest === "") {
        // log.clear(): really erase, and expect a fresh full frame next.
        this.screen = null;
        this.candidate = null;
        return this.out(chunk);
      }
      if (this.screen === null) {
        if (this.candidate === null) return this.giveUp(chunk);
        this.adopt(this.candidate);
      }
      return this.drawFrame(rest);
    }

    if (CONTROL_ONLY.test(chunk)) return this.out(chunk);

    // No erase prefix: either the very first frame, the frame Ink restores
    // after a console write, or that console output itself.
    if (this.screen === null && (this.lastFrame === "" || chunk === this.lastFrame) && chunk.endsWith("\n")) {
      this.candidate = null;
      return this.drawFrame(chunk);
    }
    if (this.screen !== null) {
      // Output we did not expect while a frame is on screen: our idea of the
      // cursor is no longer reliable.
      return this.giveUp(chunk);
    }
    this.candidate = chunk.endsWith("\n") ? chunk : null;
    this.out(chunk);
  }

  /** Treats raw output already on screen as the current frame. */
  private adopt(frame: string): void {
    this.screen = frame.slice(0, -1).split("\n");
    this.lastFrame = frame;
    this.candidate = null;
  }

  private drawFrame(frame: string): void {
    if (!frame.endsWith("\n")) return this.giveUp(frame);
    const next = frame.slice(0, -1).split("\n");
    const prev = this.screen;
    this.lastFrame = frame;
    this.screen = next;

    if (prev === null) return this.out(frame);

    let buf = prev.length > 0 ? `${ESC}${prev.length}A\r` : "\r";
    for (let i = 0; i < next.length; i++) {
      buf += next[i] === prev[i] ? "\r\n" : `${ERASE_LINE}${next[i]}\r\n`;
    }
    const extra = prev.length - next.length;
    if (extra > 0) {
      buf += `${ERASE_LINE}\r\n`.repeat(extra) + `${ESC}${extra}A`;
    }
    this.out(buf);
  }

  private giveUp(chunk: string): void {
    this.passthrough = true;
    this.screen = null;
    this.out(chunk);
  }
}

/**
 * A stdout stand-in for Ink: same size, TTY flags and resize events as the
 * real stream, but frames go through a FrameDiffer.
 */
export function createFrameDiffStdout(target: NodeJS.WriteStream): NodeJS.WriteStream {
  const differ = new FrameDiffer((chunk) => {
    target.write(chunk);
  });
  const write = (chunk: unknown, encodingOrCb?: unknown, cb?: unknown): boolean => {
    differ.write(typeof chunk === "string" ? chunk : Buffer.from(chunk as Uint8Array).toString("utf8"));
    const done = typeof encodingOrCb === "function" ? encodingOrCb : cb;
    if (typeof done === "function") process.nextTick(done as () => void);
    return true;
  };
  return new Proxy(target, {
    get(t, prop) {
      if (prop === "write") return write;
      const value = Reflect.get(t, prop, t);
      return typeof value === "function" ? value.bind(t) : value;
    },
  });
}

// Re-exported for tests that assert on raw sequences.
export const ESCAPES = { ERASE_LINE, CURSOR_UP_1, CURSOR_LEFT };
