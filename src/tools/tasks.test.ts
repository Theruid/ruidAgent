import { describe, it } from "node:test";
import assert from "node:assert";
import { TaskStore, taskCreateTool, taskUpdateTool, taskListTool } from "./tasks.js";

describe("Task Store & Task Management Tools", () => {
  it("creates, updates, and lists tasks", async () => {
    const store = new TaskStore();
    const create = taskCreateTool(store);
    const update = taskUpdateTool(store);
    const list = taskListTool(store);

    const createRes = await create.execute({ subject: "Refactor auth", description: "Use JWT tokens" });
    assert(createRes.includes("Created task #1"));

    const tasks = store.list();
    assert.strictEqual(tasks.length, 1);
    assert.strictEqual(tasks[0].subject, "Refactor auth");
    assert.strictEqual(tasks[0].status, "pending");

    await update.execute({ id: "1", status: "in_progress" });
    assert.strictEqual(store.list()[0].status, "in_progress");

    const listOutput = await list.execute();
    assert(listOutput.includes("Refactor auth"));
    assert(listOutput.includes("in_progress"));
  });
});
