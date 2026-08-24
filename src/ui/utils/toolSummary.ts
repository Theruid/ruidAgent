/**
 * Generates a clean, concise single-line badge summary for any tool call.
 */
export function formatToolBadge(
  toolName: string,
  input?: Record<string, unknown>,
  resultText?: string,
  isError?: boolean,
): { title: string; detail: string } {
  const inp = input || {};
  let target = "";
  let meta = "";

  switch (toolName) {
    case "read_file": {
      target = String(inp.path || "");
      if (resultText && !isError) {
        const lineCount = resultText.split("\n").length;
        meta = `${lineCount} line${lineCount === 1 ? "" : "s"}`;
      }
      break;
    }
    case "write_file": {
      target = String(inp.path || "");
      if (typeof inp.content === "string") {
        const lineCount = inp.content.split("\n").length;
        meta = `${lineCount} lines written`;
      } else if (resultText && !isError) {
        meta = resultText.replace(/\n/g, " ").trim();
      }
      break;
    }
    case "edit_file": {
      target = String(inp.path || "");
      if (resultText && !isError) {
        meta = resultText.replace(/^Edited\s+[^\s]+\s*/, "").replace(/[()]/g, "").trim();
      }
      break;
    }
    case "bash": {
      const cmd = String(inp.command || "");
      target = cmd.length > 50 ? cmd.slice(0, 48) + "…" : cmd;
      if (isError) {
        meta = "failed";
      } else if (resultText) {
        const lineCount = resultText.split("\n").length;
        meta = `${lineCount} line${lineCount === 1 ? "" : "s"} output`;
      }
      break;
    }
    case "glob": {
      target = String(inp.pattern || "");
      if (resultText && !isError) {
        const lines = resultText.split("\n").filter((l) => l.trim() && !l.startsWith("("));
        meta = `${lines.length} match${lines.length === 1 ? "" : "es"}`;
      }
      break;
    }
    case "grep": {
      target = `"${String(inp.pattern || "")}"`;
      if (inp.path) target += ` in ${inp.path}`;
      if (resultText && !isError) {
        const lines = resultText.split("\n").filter((l) => l.trim() && !l.startsWith("("));
        meta = `${lines.length} match${lines.length === 1 ? "" : "es"}`;
      }
      break;
    }
    case "list_dir": {
      target = String(inp.path || ".");
      if (resultText && !isError) {
        const lines = resultText.split("\n").filter((l) => l.trim());
        meta = `${lines.length} item${lines.length === 1 ? "" : "s"}`;
      }
      break;
    }
    default: {
      target = Object.values(inp)[0] ? String(Object.values(inp)[0]) : "";
      if (target.length > 40) target = target.slice(0, 38) + "…";
    }
  }

  const title = toolName;
  const detail = [target, meta ? `(${meta})` : ""].filter(Boolean).join(" ");
  return { title, detail };
}
