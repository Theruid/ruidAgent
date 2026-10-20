import * as path from "node:path";
import { createRequire } from "node:module";

let tsModule: any = null;
let tsLoadAttempted = false;

/**
 * Loads the TypeScript compiler lazily and synchronously.
 *
 * This module is shared by the ESM CLI and the bundled CJS Electron main
 * process, so it resolves the compiler through `require` when available and
 * falls back to `createRequire` for native ESM. Syntax checking degrades
 * gracefully when the compiler is not installed.
 */
function loadTypeScript(): any {
  if (tsLoadAttempted) return tsModule;
  tsLoadAttempted = true;

  try {
    const requireFn =
      typeof require === "function" ? require : createRequire(import.meta.url);
    const loaded = requireFn("typescript");
    tsModule = loaded?.default ?? loaded;
  } catch {
    tsModule = null;
  }

  return tsModule;
}

export interface DiagnosticResult {
  hasErrors: boolean;
  messages: string[];
}

/**
 * Rapidly verifies syntax and reports parse/compiler errors on TypeScript and JavaScript files.
 */
export function checkFileSyntax(filePath: string, content: string): DiagnosticResult {
  const ts = loadTypeScript();
  if (!ts) {
    return { hasErrors: false, messages: [] };
  }

  const ext = path.extname(filePath).toLowerCase();
  const isTs = ext === ".ts" || ext === ".tsx";
  const isJs = ext === ".js" || ext === ".jsx" || ext === ".mjs" || ext === ".cjs";

  if (!isTs && !isJs) {
    return { hasErrors: false, messages: [] };
  }

  const scriptKind =
    ext === ".tsx"
      ? ts.ScriptKind.TSX
      : ext === ".ts"
        ? ts.ScriptKind.TS
        : ext === ".jsx"
          ? ts.ScriptKind.JSX
          : ts.ScriptKind.JS;

  try {
    const sourceFile = ts.createSourceFile(
      filePath,
      content,
      ts.ScriptTarget.Latest,
      true,
      scriptKind
    );

    const diagnostics = (sourceFile as any).parseDiagnostics ?? [];
    if (diagnostics.length === 0) {
      return { hasErrors: false, messages: [] };
    }

    const messages = diagnostics.slice(0, 3).map((d: any) => {
      let lineNum = 1;
      if (d.file && typeof d.start === "number") {
        const lineAndChar = d.file.getLineAndCharacterOfPosition(d.start);
        lineNum = lineAndChar.line + 1;
      }
      const msgText = typeof d.messageText === "string" ? d.messageText : d.messageText.messageText;
      return `Line ${lineNum}: ${msgText}`;
    });

    return { hasErrors: true, messages };
  } catch {
    return { hasErrors: false, messages: [] };
  }
}

