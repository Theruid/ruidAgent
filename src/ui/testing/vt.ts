import stringWidth from "string-width";

/**
 * A minimal VT100-style screen for tests: replays what Ink writes to stdout
 * (text, CR/LF, cursor moves, line erases, scrolling, deferred wrap) and
 * exposes the resulting screen. It lets tests assert what a user would see —
 * e.g. that a redraw left no stale duplicate lines behind.
 */
export class VirtualScreen {
  private grid: string[][];
  private row = 0;
  private col = 0;
  /** Set after writing the last column; the next printable char wraps first. */
  private pendingWrap = false;
  /** Lines scrolled off the top. */
  readonly scrollback: string[] = [];

  constructor(
    readonly rows: number,
    readonly columns: number,
  ) {
    this.grid = Array.from({ length: rows }, () => this.blank());
  }

  private blank(): string[] {
    return Array.from({ length: this.columns }, () => " ");
  }

  private lineFeed(): void {
    if (this.row === this.rows - 1) {
      this.scrollback.push(this.grid.shift()!.join("").trimEnd());
      this.grid.push(this.blank());
    } else {
      this.row++;
    }
  }

  private put(ch: string): void {
    const w = Math.max(1, stringWidth(ch));
    if (this.pendingWrap || this.col + w > this.columns) {
      this.col = 0;
      this.lineFeed();
      this.pendingWrap = false;
    }
    this.grid[this.row][this.col] = ch;
    for (let i = 1; i < w; i++) this.grid[this.row][this.col + i] = "";
    this.col += w;
    if (this.col >= this.columns) {
      this.col = this.columns - 1;
      this.pendingWrap = true;
    }
  }

  write(data: string): void {
    let i = 0;
    while (i < data.length) {
      const ch = data[i];
      if (ch === "\x1b") {
        const m = /^\x1b\[([?0-9;]*)([A-Za-z])/.exec(data.slice(i));
        if (m) {
          this.csi(m[1], m[2]);
          i += m[0].length;
          continue;
        }
        const osc = /^\x1b\][^\x07]*(\x07|\x1b\\)/.exec(data.slice(i));
        i += osc ? osc[0].length : 1;
        continue;
      }
      if (ch === "\n") {
        // Terminals in cooked output translate LF to CR+LF.
        this.col = 0;
        this.pendingWrap = false;
        this.lineFeed();
      } else if (ch === "\r") {
        this.col = 0;
        this.pendingWrap = false;
      } else if (ch >= " ") {
        const cp = data.codePointAt(i)!;
        const s = String.fromCodePoint(cp);
        this.put(s);
        i += s.length;
        continue;
      }
      i++;
    }
  }

  private csi(params: string, cmd: string): void {
    if (params.startsWith("?")) return; // cursor visibility, sync output, etc.
    if (cmd === "m") return; // colours never move the cursor
    const nums = params.split(";").map((n) => (n === "" ? NaN : Number(n)));
    const n = Number.isNaN(nums[0]) ? 1 : nums[0];
    this.pendingWrap = false;
    switch (cmd) {
      case "A":
        this.row = Math.max(0, this.row - n);
        break;
      case "B":
        this.row = Math.min(this.rows - 1, this.row + n);
        break;
      case "C":
        this.col = Math.min(this.columns - 1, this.col + n);
        break;
      case "D":
        this.col = Math.max(0, this.col - n);
        break;
      case "E":
        this.row = Math.min(this.rows - 1, this.row + n);
        this.col = 0;
        break;
      case "G":
        this.col = Math.min(this.columns - 1, n - 1);
        break;
      case "H": {
        const r = Number.isNaN(nums[0]) ? 1 : nums[0];
        const c = Number.isNaN(nums[1]) ? 1 : nums[1];
        this.row = Math.min(this.rows - 1, r - 1);
        this.col = Math.min(this.columns - 1, c - 1);
        break;
      }
      case "K": {
        const mode = Number.isNaN(nums[0]) ? 0 : nums[0];
        const line = this.grid[this.row];
        if (mode === 0) for (let c = this.col; c < this.columns; c++) line[c] = " ";
        else if (mode === 1) for (let c = 0; c <= this.col; c++) line[c] = " ";
        else this.grid[this.row] = this.blank();
        break;
      }
      case "J": {
        const mode = Number.isNaN(nums[0]) ? 0 : nums[0];
        if (mode === 2 || mode === 3) this.grid = Array.from({ length: this.rows }, () => this.blank());
        break;
      }
      // SGR colours and anything else don't move the cursor.
    }
  }

  /** The visible screen, one string per row, trailing spaces trimmed. */
  lines(): string[] {
    return this.grid.map((r) => r.join("").trimEnd());
  }

  /** Visible rows containing `text`. */
  count(text: string): number {
    return this.lines().filter((l) => l.includes(text)).length;
  }
}
