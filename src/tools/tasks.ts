import { z } from "zod";

export interface AgentTask {
  id: string;
  subject: string;
  status: "pending" | "in_progress" | "completed";
  description?: string;
  createdAt: number;
  updatedAt: number;
}

export class TaskStore {
  private tasks = new Map<string, AgentTask>();
  private nextId = 1;

  create(subject: string, description?: string): AgentTask {
    const task: AgentTask = {
      id: String(this.nextId++),
      subject,
      status: "pending",
      description,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.tasks.set(task.id, task);
    return task;
  }

  update(id: string, patch: { status?: AgentTask["status"]; subject?: string; description?: string }): AgentTask {
    const task = this.tasks.get(id);
    if (!task) {
      throw new Error(`Task #${id} not found.`);
    }
    if (patch.status) task.status = patch.status;
    if (patch.subject) task.subject = patch.subject;
    if (patch.description !== undefined) task.description = patch.description;
    task.updatedAt = Date.now();
    return task;
  }

  delete(id: string): boolean {
    if (!this.tasks.has(id)) {
      throw new Error(`Task #${id} not found.`);
    }
    return this.tasks.delete(id);
  }

  restore(tasks: AgentTask[]): void {
    this.tasks.clear();
    let maxId = 0;
    for (const t of tasks) {
      this.tasks.set(t.id, { ...t });
      const num = parseInt(t.id, 10);
      if (!isNaN(num) && num > maxId) {
        maxId = num;
      }
    }
    this.nextId = maxId + 1;
  }

  list(): AgentTask[] {
    return [...this.tasks.values()];
  }

  clear(): void {
    this.tasks.clear();
    this.nextId = 1;
  }
}

export function taskCreateTool(store: TaskStore) {
  return {
    name: "task_create",
    description: "Create a new tracking task or todo item in the agent's plan.",
    parameters: {
      type: "object",
      properties: {
        subject: { type: "string", description: "Brief title/action for the task" },
        description: { type: "string", description: "Optional detailed description or acceptance criteria" },
      },
      required: ["subject"],
    },
    schema: z.object({
      subject: z.string().min(1),
      description: z.string().optional(),
    }),
    async execute(args: { subject: string; description?: string }): Promise<string> {
      const t = store.create(args.subject, args.description);
      return `Created task #${t.id}: "${t.subject}" [status: ${t.status}]`;
    },
  };
}

export function taskUpdateTool(store: TaskStore) {
  return {
    name: "task_update",
    description: "Update the status or details of a task (set to in_progress when working, completed when done).",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "Task ID" },
        status: { type: "string", enum: ["pending", "in_progress", "completed"], description: "New status" },
        subject: { type: "string", description: "Updated subject" },
        description: { type: "string", description: "Updated description" },
      },
      required: ["id"],
    },
    schema: z.object({
      id: z.string().min(1),
      status: z.enum(["pending", "in_progress", "completed"]).optional(),
      subject: z.string().optional(),
      description: z.string().optional(),
    }),
    async execute(args: {
      id: string;
      status?: "pending" | "in_progress" | "completed";
      subject?: string;
      description?: string;
    }): Promise<string> {
      const t = store.update(args.id, args);
      return `Updated task #${t.id}: "${t.subject}" [status: ${t.status}]`;
    },
  };
}

export function taskDeleteTool(store: TaskStore) {
  return {
    name: "task_delete",
    description: "Delete a task from the tracking list by its ID.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "Task ID to delete" },
      },
      required: ["id"],
    },
    schema: z.object({
      id: z.string().min(1),
    }),
    async execute(args: { id: string }): Promise<string> {
      store.delete(args.id);
      return `Deleted task #${args.id}.`;
    },
  };
}

export function taskListTool(store: TaskStore) {
  return {
    name: "task_list",
    description: "List all tracked tasks with their status.",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
    schema: z.object({}),
    async execute(): Promise<string> {
      const tasks = store.list();
      if (tasks.length === 0) return "No tasks tracked.";
      return tasks
        .map((t) => `#${t.id} [${t.status}] ${t.subject}${t.description ? ` — ${t.description}` : ""}`)
        .join("\n");
    },
  };
}
