import { describe, it } from "node:test";
import assert from "node:assert";
import { formatInlineMarkdown, renderMarkdown } from "./markdown.js";

describe("Markdown Terminal Renderer (markdown.ts)", () => {
  it("formats inline code, bold, and italic markdown", () => {
    const text = "Use `const x = 1` with **bold** and *italic* text";
    const formatted = formatInlineMarkdown(text);
    // Inline code in bright yellow
    assert.ok(formatted.includes("\x1b[93mconst x = 1\x1b[0m"));
    // Bold
    assert.ok(formatted.includes("\x1b[1mbold\x1b[0m"));
    // Italic
    assert.ok(formatted.includes("\x1b[3mitalic\x1b[0m"));
  });

  it("renders markdown headings (H1, H2, H3)", () => {
    const md = "# Title 1\n## Section 2\n### Subsection 3";
    const lines = renderMarkdown(md, 80);
    assert.strictEqual(lines.length, 3);
    assert.ok(lines[0].text.includes("■ Title 1"));
    assert.ok(lines[1].text.includes("◆ Section 2"));
    assert.ok(lines[2].text.includes("● Subsection 3"));
  });

  it("renders blockquotes and lists (unordered and numbered)", () => {
    const md = `> Note: this is important\n\n- Bullet item 1\n- Bullet item 2\n\n1. First step\n2. Second step`;
    const lines = renderMarkdown(md, 60);
    const lineTexts = lines.map((l) => l.text);
    assert.ok(lineTexts.some((t) => t.includes("Note: this is important")));
    assert.ok(lineTexts.some((t) => t.includes("•") && t.includes("Bullet item 1")));
    assert.ok(lineTexts.some((t) => t.includes("1.") && t.includes("First step")));
  });

  it("renders fenced code blocks with box frame, line numbering, and syntax styling", () => {
    const md = "```typescript\nconst greeting = 'hi';\nconsole.log(greeting);\n```";
    const lines = renderMarkdown(md, 60);
    assert.ok(lines.length >= 4);
    assert.ok(lines.some((l) => l.isCode && l.text.includes("typescript")));
    assert.ok(lines.some((l) => l.isCode && l.text.includes("1 │")));
    assert.ok(lines.some((l) => l.isCode && l.text.includes("2 │")));
    assert.ok(lines[lines.length - 1].text.includes("└"));
  });

  it("handles unclosed code blocks during streaming gracefully", () => {
    const md = "```js\nconst inFlight = true;";
    const lines = renderMarkdown(md, 60);
    assert.ok(lines.length >= 2);
    // Should auto-close the bottom border
    assert.ok(lines[lines.length - 1].text.includes("└"));
  });
});
