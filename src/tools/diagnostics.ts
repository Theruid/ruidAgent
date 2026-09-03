import * as path from "node:path";

let tsModule: any = null;
try {
  tsModule = await import("typescript").then((m) => m.default ?? m).catch(() => null);
} catch {
  // If typescript is unavailable, syntax checking gracefully falls back
}

export interface DiagnosticResult {
  hasErrors: boolean;
  messages: string[];
}

/**
 * Rapidly verifies syntax and reports parse/compiler errors on TypeScript and JavaScript files.
 */
export function checkFileSyntax(filePath: string, content: string): DiagnosticResult {
  if (!tsModule) {
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
      ? tsModule.ScriptKind.TSX
      : ext === ".ts"
        ? tsModule.ScriptKind.TS
        : ext === ".jsx"
          ? tsModule.ScriptKind.JSX
          : tsModule.ScriptKind.JS;

  try {
    const sourceFile = tsModule.createSourceFile(
      filePath,
      content,
      tsModule.ScriptTarget.Latest,
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

