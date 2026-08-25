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
    case "git_status": {
      target = "status";
      if (resultText && !isError) {
        meta = resultText.includes("(clean") ? "clean" : "changes";
      }
      break;
    }
    case "git_diff": {
      target = inp.path ? String(inp.path) : inp.staged ? "staged" : "working tree";
      if (resultText && !isError) {
        const lineCount = resultText.split("\n").length;
        meta = `${lineCount} lines`;
      }
      break;
    }
    case "git_log": {
      target = `last ${inp.maxCount || 10} commits`;
      if (resultText && !isError) {
        const count = resultText.split("\n").filter((l) => l.trim()).length;
        meta = `${count} commits`;
      }
      break;
    }
    case "task_create": {
      target = String(inp.subject || "");
      if (resultText && !isError) {
        const match = resultText.match(/#(\d+)/);
        meta = match ? `#${match[1]}` : "created";
      }
      break;
    }
    case "task_update": {
      target = `#${inp.id} ${inp.status || ""}`.trim();
      meta = isError ? "failed" : "updated";
      break;
    }
    case "task_list": {
      target = "tasks";
      if (resultText && !isError) {
        const count = resultText.split("\n").filter((l) => l.startsWith("#")).length;
        meta = `${count} task${count === 1 ? "" : "s"}`;
      }
      break;
    }
    case "rollback": {
      target = inp.turn ? `turn #${inp.turn}` : "latest turn";
      if (resultText && !isError) {
        meta = resultText.includes("Restored") || resultText.includes("Removed") ? "reverted" : "no files";
      }
      break;
    }
    case "subagent_spawn": {
      const role = String(inp.role || "general").toUpperCase();
      target = `[${role}] ${String(inp.prompt || "").slice(0, 45)}…`;
      if (resultText && !isError) {
        meta = "completed";
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
