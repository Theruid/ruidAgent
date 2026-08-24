/**
 * Lightweight terminal syntax highlighter using ANSI escape codes for Ink/Terminal.
 */

const KEYWORDS_JS_TS = new Set([
  "abstract", "any", "as", "async", "await", "boolean", "break", "case", "catch",
  "class", "const", "continue", "debugger", "declare", "default", "delete", "do",
  "else", "enum", "export", "extends", "false", "finally", "for", "from", "function",
  "get", "if", "implements", "import", "in", "infer", "instanceof", "interface",
  "is", "keyof", "let", "module", "namespace", "never", "new", "null", "number",
  "object", "of", "package", "private", "protected", "public", "readonly", "require",
  "return", "set", "static", "string", "super", "switch", "symbol", "this", "throw",
  "true", "try", "type", "typeof", "undefined", "unknown", "var", "void", "while",
  "with", "yield",
]);

const KEYWORDS_PYTHON = new Set([
  "and", "as", "assert", "async", "await", "break", "class", "continue", "def",
  "del", "elif", "else", "except", "False", "finally", "for", "from", "global",
  "if", "import", "in", "is", "lambda", "None", "nonlocal", "not", "or", "pass",
  "raise", "return", "True", "try", "while", "with", "yield", "self",
]);

const KEYWORDS_BASH = new Set([
  "if", "then", "else", "elif", "fi", "case", "esac", "for", "while", "until",
  "do", "done", "in", "function", "select", "time", "export", "source", "alias",
  "echo", "cd", "pwd", "mkdir", "rm", "cp", "mv", "touch", "cat", "grep", "chmod",
  "chown", "curl", "npm", "node", "git", "npx", "tsx", "tsc",
]);

const KEYWORDS_GENERIC = new Set([
  "fn", "pub", "struct", "impl", "trait", "mut", "match", "use", "mod", "crate", // Rust
  "package", "func", "struct", "type", "interface", "map", "chan", "go", "select", // Go
  "select", "from", "where", "insert", "update", "delete", "create", "table", "join", // SQL
  ...KEYWORDS_JS_TS,
  ...KEYWORDS_PYTHON,
  ...KEYWORDS_BASH,
]);

// ANSI color escape codes for terminal text
const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  italic: "\x1b[3m",
  underline: "\x1b[4m",

  // Foreground colors
  black: "\x1b[30m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  gray: "\x1b[90m",

  // Bright colors
  redBright: "\x1b[91m",
  greenBright: "\x1b[92m",
  yellowBright: "\x1b[93m",
  blueBright: "\x1b[94m",
  magentaBright: "\x1b[95m",
  cyanBright: "\x1b[96m",
  whiteBright: "\x1b[97m",

  // Backgrounds
  bgGray: "\x1b[100m",
};

/**
 * Highlights a single line of code based on language.
 */
export function highlightCodeLine(line: string, lang = ""): string {
  const l = lang.toLowerCase().trim();
  let keywords = KEYWORDS_GENERIC;
  if (["js", "javascript", "ts", "typescript", "jsx", "tsx", "json"].includes(l)) {
    keywords = KEYWORDS_JS_TS;
  } else if (["py", "python"].includes(l)) {
    keywords = KEYWORDS_PYTHON;
  } else if (["sh", "bash", "zsh", "shell"].includes(l)) {
    keywords = KEYWORDS_BASH;
  }

  // Check for full line comments
  const trimmed = line.trimStart();
  if (trimmed.startsWith("//") || trimmed.startsWith("#") || trimmed.startsWith("/*") || trimmed.startsWith("*")) {
    return `${ANSI.gray}${line}${ANSI.reset}`;
  }

  // Tokenize line by regex matching strings, comments, numbers, keywords, and identifiers
  const tokenRegex = /(\/\/[^\n]*|#[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b\d+(?:\.\d+)?\b|\b[a-zA-Z_$][a-zA-Z0-9_$]*\b|[^\s\w]+|\s+)/g;

  let result = "";
  let match: RegExpExecArray | null;

  while ((match = tokenRegex.exec(line)) !== null) {
    const token = match[0];

    // Comment
    if (token.startsWith("//") || token.startsWith("#")) {
      result += `${ANSI.gray}${token}${ANSI.reset}`;
    }
    // String
    else if (
      (token.startsWith('"') && token.endsWith('"')) ||
      (token.startsWith("'") && token.endsWith("'")) ||
      (token.startsWith("`") && token.endsWith("`"))
    ) {
      result += `${ANSI.greenBright}${token}${ANSI.reset}`;
    }
    // Number
    else if (/^\d+(\.\d+)?$/.test(token)) {
      result += `${ANSI.yellow}${token}${ANSI.reset}`;
    }
    // Keyword
    else if (keywords.has(token)) {
      result += `${ANSI.magentaBright}${ANSI.bold}${token}${ANSI.reset}`;
    }
    // Function call e.g. foo(
    else if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(token)) {
      const nextChar = line[tokenRegex.lastIndex];
      if (nextChar === "(") {
        result += `${ANSI.blueBright}${token}${ANSI.reset}`;
      } else if (/^[A-Z][a-zA-Z0-9_$]*$/.test(token)) {
        // Types / Classes starting with uppercase
        result += `${ANSI.cyanBright}${token}${ANSI.reset}`;
      } else {
        result += token;
      }
    }
    // Operators / Punctuation
    else if (/[=+\-*/><!&|%?:;.,{}()[\]]/.test(token)) {
      result += `${ANSI.cyan}${token}${ANSI.reset}`;
    } else {
      result += token;
    }
  }

  return result || line;
}
