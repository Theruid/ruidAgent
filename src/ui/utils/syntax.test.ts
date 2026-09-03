import { describe, it } from "node:test";
import assert from "node:assert";
import { highlightCodeLine } from "./syntax.js";

describe("Terminal Syntax Highlighter (syntax.ts)", () => {
  it("highlights single line comments in gray", () => {
    const tsComment = "// this is a comment";
    const outTs = highlightCodeLine(tsComment, "ts");
    assert.ok(outTs.includes("\x1b[90m")); // ANSI gray
    assert.ok(outTs.includes(tsComment));

    const pyComment = "# python comment";
    const outPy = highlightCodeLine(pyComment, "python");
    assert.ok(outPy.includes("\x1b[90m"));
  });

  it("highlights TypeScript/JavaScript keywords and types", () => {
    const code = "const message: string = 'hello world';";
    const out = highlightCodeLine(code, "ts");
    // Keywords in magenta/bold
    assert.ok(out.includes("\x1b[95m\x1b[1mconst\x1b[0m"));
    // Strings in bright green
    assert.ok(out.includes("\x1b[92m'hello world'\x1b[0m"));
    // Types/Class identifiers starting with uppercase or type keywords
    assert.ok(out.includes("string"));
  });

  it("highlights function calls in bright blue", () => {
    const code = "console.log('test');";
    const out = highlightCodeLine(code, "js");
    assert.ok(out.includes("\x1b[94mlog\x1b[0m"));
  });

  it("highlights numbers in yellow", () => {
    const code = "const count = 42.5;";
    const out = highlightCodeLine(code, "ts");
    assert.ok(out.includes("\x1b[33m42.5\x1b[0m"));
  });

  it("highlights Python syntax and keywords", () => {
    const code = "def calculate_sum(self, x):";
    const out = highlightCodeLine(code, "python");
    assert.ok(out.includes("def"));
    assert.ok(out.includes("self"));
  });

  it("highlights Bash commands and keywords", () => {
    const code = "if [ -f file ]; then echo 'found'; fi";
    const out = highlightCodeLine(code, "bash");
    assert.ok(out.includes("echo"));
    assert.ok(out.includes("then"));
  });
});
