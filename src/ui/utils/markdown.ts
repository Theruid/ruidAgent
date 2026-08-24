import { highlightCodeLine } from "./syntax.js";
import { wrapText } from "./wrap.js";

const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  italic: "\x1b[3m",
  underline: "\x1b[4m",
  cyan: "\x1b[36m",
  cyanBright: "\x1b[96m",
  blueBright: "\x1b[94m",
  magentaBright: "\x1b[95m",
  yellowBright: "\x1b[93m",
  greenBright: "\x1b[92m",
  gray: "\x1b[90m",
};

/**
 * Format inline markdown tokens: `code`, **bold**, *italic*, [link](url)
 */
export function formatInlineMarkdown(text: string): string {
  // Inline code: `code`
  let res = text.replace(/`([^`]+)`/g, (_m, code) => {
    return `${ANSI.yellowBright}${code}${ANSI.reset}`;
  });

  // Bold: **text** or __text__
  res = res.replace(/(\*\*|__)(.*?)\1/g, (_m, _delim, content) => {
    return `${ANSI.bold}${content}${ANSI.reset}`;
  });

  // Italic: *text* or _text_
  res = res.replace(/(?<!\*)\*(?!\*)(.*?)(?<!\*)\*(?!\*)|(?<!_)_(?!_)(.*?)(?<!_)_(?!_)/g, (_m, c1, c2) => {
    const content = c1 ?? c2;
    return `${ANSI.italic}${content}${ANSI.reset}`;
  });

  return res;
}

export interface MarkdownLine {
  text: string;
  isCode?: boolean;
}

/**
 * Parses markdown text into formatted terminal lines, wrapping as necessary.
 */
export function renderMarkdown(markdown: string, contentWidth: number): MarkdownLine[] {
  const width = Math.max(20, contentWidth);
  const rawLines = markdown.split(/\r?\n/);
  const outLines: MarkdownLine[] = [];

  let inCodeBlock = false;
  let codeLang = "";
  let codeLineNum = 1;

  for (let i = 0; i < rawLines.length; i++) {
    const raw = rawLines[i];
    const trimmed = raw.trim();

    // Check code fence start/stop
    if (trimmed.startsWith("```")) {
      if (!inCodeBlock) {
        // Start of code block
        inCodeBlock = true;
        codeLang = trimmed.slice(3).trim() || "code";
        codeLineNum = 1;

        const headerTitle = ` ${codeLang} `;
        const lineLen = Math.max(0, width - headerTitle.length - 4);
        const header = `${ANSI.gray}┌─${ANSI.reset}${ANSI.cyanBright}${ANSI.bold}${headerTitle}${ANSI.reset}${ANSI.gray}${"─".repeat(lineLen)}┐${ANSI.reset}`;
        outLines.push({ text: header, isCode: true });
      } else {
        // End of code block
        inCodeBlock = false;
        const footer = `${ANSI.gray}└${"─".repeat(Math.max(0, width - 2))}┘${ANSI.reset}`;
        outLines.push({ text: footer, isCode: true });
      }
      continue;
    }

    if (inCodeBlock) {
      // Inside code block: syntax highlight each line
      const highlighted = highlightCodeLine(raw, codeLang);
      const lineNumStr = `${ANSI.gray}${String(codeLineNum).padStart(3, " ")} │${ANSI.reset} `;
      outLines.push({ text: `${ANSI.gray}│${ANSI.reset} ${lineNumStr}${highlighted}`, isCode: true });
      codeLineNum++;
      continue;
    }

    // Heading 1 (# ...)
    if (trimmed.startsWith("# ")) {
      const title = formatInlineMarkdown(trimmed.slice(2));
      outLines.push({ text: `${ANSI.magentaBright}${ANSI.bold}■ ${title}${ANSI.reset}` });
      continue;
    }

    // Heading 2 (## ...)
    if (trimmed.startsWith("## ")) {
      const title = formatInlineMarkdown(trimmed.slice(3));
      outLines.push({ text: `${ANSI.cyanBright}${ANSI.bold}◆ ${title}${ANSI.reset}` });
      continue;
    }

    // Heading 3 (### ...)
    if (trimmed.startsWith("### ")) {
      const title = formatInlineMarkdown(trimmed.slice(4));
      outLines.push({ text: `${ANSI.blueBright}${ANSI.bold}● ${title}${ANSI.reset}` });
      continue;
    }

    // Blockquote (> ...)
    if (trimmed.startsWith(">")) {
      const quoteText = formatInlineMarkdown(trimmed.replace(/^>\s*/, ""));
      const wrapped = wrapText(quoteText, width - 4);
      for (const w of wrapped) {
        outLines.push({ text: `${ANSI.cyan}│${ANSI.reset} ${ANSI.dim}${w}${ANSI.reset}` });
      }
      continue;
    }

    // Unordered List (- ... or * ...)
    if (/^[-*]\s+/.test(trimmed)) {
      const itemText = formatInlineMarkdown(trimmed.replace(/^[-*]\s+/, ""));
      const wrapped = wrapText(itemText, width - 4);
      for (let j = 0; j < wrapped.length; j++) {
        const prefix = j === 0 ? `${ANSI.cyan}•${ANSI.reset} ` : "  ";
        outLines.push({ text: `  ${prefix}${wrapped[j]}` });
      }
      continue;
    }

    // Numbered List (1. ... etc)
    const numMatch = trimmed.match(/^(\d+\.)\s+(.*)$/);
    if (numMatch) {
      const numPrefix = numMatch[1];
      const itemText = formatInlineMarkdown(numMatch[2]);
      const wrapped = wrapText(itemText, width - numPrefix.length - 3);
      for (let j = 0; j < wrapped.length; j++) {
        const prefix = j === 0 ? `${ANSI.cyan}${numPrefix}${ANSI.reset} ` : "   ";
        outLines.push({ text: `  ${prefix}${wrapped[j]}` });
      }
      continue;
    }

    // Normal paragraph text
    if (!trimmed) {
      outLines.push({ text: "" });
      continue;
    }

    const formatted = formatInlineMarkdown(raw);
    const wrapped = wrapText(formatted, width);
    for (const w of wrapped) {
      outLines.push({ text: w });
    }
  }

  // If streaming cut off inside a code block, close the box nicely
  if (inCodeBlock) {
    outLines.push({ text: `${ANSI.gray}└${"─".repeat(Math.max(0, width - 2))}┘${ANSI.reset}`, isCode: true });
  }

  return outLines;
}
