import { existsSync, promises as fs, statSync } from "node:fs";
import * as path from "node:path";

export interface SymbolDefinition {
  kind: "class" | "interface" | "type" | "function" | "enum" | "const";
  name: string;
  signature?: string;
}

export interface FileSymbols {
  filePath: string;
  symbols: SymbolDefinition[];
}

const IGNORE_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "out",
  ".next",
  ".venv",
  "venv",
  "__pycache__",
  ".cache",
  ".idea",
  ".vscode",
  "coverage",
]);

const SUPPORTED_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".go",
  ".rs",
]);

/**
 * Fast AST / regex symbol extractor for common languages without external native bindings.
 */
export function extractSymbolsFromContent(content: string, ext: string): SymbolDefinition[] {
  const symbols: SymbolDefinition[] = [];
  const lines = content.split("\n");

  const isTypeScript = ext === ".ts" || ext === ".tsx" || ext === ".js" || ext === ".jsx" || ext === ".mjs" || ext === ".cjs";
  const isPython = ext === ".py";
  const isGo = ext === ".go";
  const isRust = ext === ".rs";

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("#") || trimmed.startsWith("/*") || trimmed.startsWith("*")) {
      continue;
    }

    if (isTypeScript) {
      // Exported functions
      const fnMatch = trimmed.match(/^export\s+(?:async\s+)?function\s+([a-zA-Z0-9_$]+)\s*\(([^)]*)\)/);
      if (fnMatch) {
        symbols.push({ kind: "function", name: fnMatch[1], signature: `(${fnMatch[2]})` });
        continue;
      }

      // Exported classes
      const classMatch = trimmed.match(/^export\s+(?:abstract\s+)?class\s+([a-zA-Z0-9_$]+)/);
      if (classMatch) {
        symbols.push({ kind: "class", name: classMatch[1] });
        continue;
      }

      // Exported interfaces
      const ifaceMatch = trimmed.match(/^export\s+interface\s+([a-zA-Z0-9_$]+)/);
      if (ifaceMatch) {
        symbols.push({ kind: "interface", name: ifaceMatch[1] });
        continue;
      }

      // Exported types
      const typeMatch = trimmed.match(/^export\s+type\s+([a-zA-Z0-9_$]+)/);
      if (typeMatch) {
        symbols.push({ kind: "type", name: typeMatch[1] });
        continue;
      }

      // Exported enums
      const enumMatch = trimmed.match(/^export\s+enum\s+([a-zA-Z0-9_$]+)/);
      if (enumMatch) {
        symbols.push({ kind: "enum", name: enumMatch[1] });
        continue;
      }

      // Exported const functions / objects
      const constMatch = trimmed.match(/^export\s+const\s+([a-zA-Z0-9_$]+)\s*(?::\s*[^=]+)?\s*=/);
      if (constMatch) {
        symbols.push({ kind: "const", name: constMatch[1] });
        continue;
      }
    } else if (isPython) {
      const pyClass = trimmed.match(/^class\s+([a-zA-Z0-9_]+)/);
      if (pyClass) {
        symbols.push({ kind: "class", name: pyClass[1] });
        continue;
      }
      const pyFn = trimmed.match(/^def\s+([a-zA-Z0-9_]+)\s*\(([^)]*)\)/);
      if (pyFn && !pyFn[1].startsWith("__")) {
        symbols.push({ kind: "function", name: pyFn[1], signature: `(${pyFn[2]})` });
        continue;
      }
    } else if (isGo) {
      const goFn = trimmed.match(/^func\s+(?:\([^)]+\)\s+)?([A-Z][a-zA-Z0-9_]+)\s*\(([^)]*)\)/);
      if (goFn) {
        symbols.push({ kind: "function", name: goFn[1], signature: `(${goFn[2]})` });
        continue;
      }
      const goType = trimmed.match(/^type\s+([A-Z][a-zA-Z0-9_]+)\s+(struct|interface)/);
      if (goType) {
        symbols.push({ kind: goType[2] === "struct" ? "class" : "interface", name: goType[1] });
        continue;
      }
    } else if (isRust) {
      const rustFn = trimmed.match(/^pub\s+(?:async\s+)?fn\s+([a-zA-Z0-9_]+)\s*\(([^)]*)\)/);
      if (rustFn) {
        symbols.push({ kind: "function", name: rustFn[1], signature: `(${rustFn[2]})` });
        continue;
      }
      const rustStruct = trimmed.match(/^pub\s+(struct|enum|trait)\s+([a-zA-Z0-9_]+)/);
      if (rustStruct) {
        symbols.push({ kind: rustStruct[1] === "trait" ? "interface" : "class", name: rustStruct[2] });
        continue;
      }
    }
  }

  return symbols;
}

/**
 * Scans workspace and builds a token-budgeted repository symbol map.
 */
export async function generateRepoMap(
  workspaceRoot: string,
  maxFiles = 40,
  maxTokens = 1200
): Promise<string | null> {
  const fileSymbols: FileSymbols[] = [];

  async function walk(currentDir: string): Promise<void> {
    if (fileSymbols.length >= maxFiles) return;

    let entries;
    try {
      entries = await fs.readdir(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    // Sort to prioritize source roots (src/, lib/)
    const sorted = entries.sort((a, b) => {
      if (a.name === "src" || a.name === "lib") return -1;
      if (b.name === "src" || b.name === "lib") return 1;
      return a.name.localeCompare(b.name);
    });

    for (const entry of sorted) {
      if (fileSymbols.length >= maxFiles) return;
      if (IGNORE_DIRS.has(entry.name)) continue;

      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (SUPPORTED_EXTENSIONS.has(ext) && !entry.name.endsWith(".test.ts") && !entry.name.endsWith(".spec.ts")) {
          try {
            const stat = statSync(fullPath);
            if (stat.size <= 256 * 1024) {
              const content = await fs.readFile(fullPath, "utf8");
              const symbols = extractSymbolsFromContent(content, ext);
              if (symbols.length > 0) {
                const relPath = path.relative(workspaceRoot, fullPath).replace(/\\/g, "/");
                fileSymbols.push({ filePath: relPath, symbols });
              }
            }
          } catch {}
        }
      }
    }
  }

  await walk(workspaceRoot);

  if (fileSymbols.length === 0) return null;

  const lines: string[] = ["<repo_map>"];
  let estimatedTokens = 10;

  for (const file of fileSymbols) {
    const fileHeader = `${file.filePath}:`;
    const symbolLines = file.symbols
      .slice(0, 10)
      .map((s) => `  ${s.kind} ${s.name}${s.signature ? s.signature.slice(0, 40) : ""}`);

    const fileBlock = `${fileHeader}\n${symbolLines.join("\n")}`;
    const blockTokens = Math.ceil(fileBlock.length / 4);

    if (estimatedTokens + blockTokens > maxTokens) {
      lines.push(`... [remaining workspace files omitted for token budget]`);
      break;
    }

    lines.push(fileBlock);
    estimatedTokens += blockTokens;
  }

  lines.push("</repo_map>");
  return lines.join("\n");
}
