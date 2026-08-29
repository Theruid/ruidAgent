import { z } from "zod";
import type { MemoryManager } from "../memory/manager.js";
import type { MemoryCategory, MemoryScope } from "../memory/types.js";

const CategoryEnum = z.enum(["user", "feedback", "project", "reference"]);
const ScopeEnum = z.enum(["workspace", "global"]);

export function memoryStoreTool(manager: MemoryManager) {
  return {
    name: "memory_store" as const,
    description: "Store or update a persistent memory record in the project or global memory store.",
    parameters: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Optional kebab-case identifier for the memory (e.g. 'code-style-guide').",
        },
        title: {
          type: "string",
          description: "Short human-readable title for the memory.",
        },
        category: {
          type: "string",
          enum: ["user", "feedback", "project", "reference"],
          description: "Taxonomy category: 'user' (profile/habits), 'feedback' (rules/corrections), 'project' (architecture/guidelines), 'reference' (external pointers).",
        },
        scope: {
          type: "string",
          enum: ["workspace", "global"],
          description: "Storage scope: 'workspace' (.ruid/memory) or 'global' (~/.ruid/memory). Defaults to 'workspace'.",
        },
        content: {
          type: "string",
          description: "Full content of the memory record in Markdown format.",
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Optional tags for search indexing.",
        },
      },
      required: ["category", "content"],
    },
    schema: z.object({
      id: z.string().optional(),
      title: z.string().optional(),
      category: CategoryEnum,
      scope: ScopeEnum.optional(),
      content: z.string(),
      tags: z.array(z.string()).optional(),
    }),
    async execute(args: {
      id?: string;
      title?: string;
      category: MemoryCategory;
      scope?: MemoryScope;
      content: string;
      tags?: string[];
    }): Promise<string> {
      const record = await manager.store(args);
      return `✓ Saved to ${record.scope} memory [${record.category}/${record.id}]: "${record.title}"`;
    },
  };
}

export function memoryRecallTool(manager: MemoryManager) {
  return {
    name: "memory_recall" as const,
    description: "Search and retrieve stored memories by keyword query across all categories and scopes.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query or keywords.",
        },
        category: {
          type: "string",
          enum: ["user", "feedback", "project", "reference"],
          description: "Optional filter by category.",
        },
        scope: {
          type: "string",
          enum: ["workspace", "global"],
          description: "Optional filter by scope.",
        },
      },
      required: ["query"],
    },
    schema: z.object({
      query: z.string(),
      category: CategoryEnum.optional(),
      scope: ScopeEnum.optional(),
    }),
    async execute(args: {
      query: string;
      category?: MemoryCategory;
      scope?: MemoryScope;
    }): Promise<string> {
      const results = await manager.recall(args.query, {
        category: args.category,
        scope: args.scope,
      });

      if (results.length === 0) {
        return `No memories matching "${args.query}".`;
      }

      const formatted = results.map((r, i) => {
        return `[${i + 1}] (${r.record.scope}/${r.record.category}) ${r.record.title} [id: ${r.record.id}]\n${r.record.content}\n`;
      });

      return `Found ${results.length} memory record(s):\n\n${formatted.join("\n")}`;
    },
  };
}

export function memoryListTool(manager: MemoryManager) {
  return {
    name: "memory_list" as const,
    description: "List all active memory records categorized by scope and taxonomy.",
    parameters: {
      type: "object",
      properties: {
        category: {
          type: "string",
          enum: ["user", "feedback", "project", "reference"],
          description: "Optional filter by category.",
        },
        scope: {
          type: "string",
          enum: ["workspace", "global"],
          description: "Optional filter by scope.",
        },
      },
    },
    schema: z.object({
      category: CategoryEnum.optional(),
      scope: ScopeEnum.optional(),
    }),
    async execute(args: {
      category?: MemoryCategory;
      scope?: MemoryScope;
    }): Promise<string> {
      const records = await manager.list(args);
      if (records.length === 0) {
        return "No memory records found.";
      }

      const lines = records.map(
        (r) =>
          `- [${r.id}] (${r.scope}/${r.category}) ${r.title} [tags: ${r.tags.join(", ") || "none"}]`
      );

      return `Total Memories (${records.length}):\n${lines.join("\n")}`;
    },
  };
}

export function memoryForgetTool(manager: MemoryManager) {
  return {
    name: "memory_forget" as const,
    description: "Delete a persistent memory record by its identifier.",
    parameters: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Identifier of the memory record to remove.",
        },
        scope: {
          type: "string",
          enum: ["workspace", "global"],
          description: "Optional scope to restrict deletion.",
        },
      },
      required: ["id"],
    },
    schema: z.object({
      id: z.string(),
      scope: ScopeEnum.optional(),
    }),
    async execute(args: { id: string; scope?: MemoryScope }): Promise<string> {
      const deleted = await manager.forget(args.id, args.scope);
      if (!deleted) {
        return `Memory record "${args.id}" not found.`;
      }
      return `✓ Removed memory record "${args.id}".`;
    },
  };
}
