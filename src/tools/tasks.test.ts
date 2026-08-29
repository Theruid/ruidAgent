import { describe, it } from "node:test";
import assert from "node:assert";
import { TaskStore, taskCreateTool, taskUpdateTool, taskDeleteTool, taskListTool } from "./tasks.js";

describe("Task Store & Task Management Tools", () => {
  it("creates, updates, deletes, and lists tasks", async () => {
    const store = new TaskStore();
    const create = taskCreateTool(store);
    const update = taskUpdateTool(store);
    const del = taskDeleteTool(store);
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

    const delRes = await del.execute({ id: "1" });
    assert(delRes.includes("Deleted task #1"));
    assert.strictEqual(store.list().length, 0);

    const emptyList = await list.execute();
    assert.strictEqual(emptyList, "No tasks tracked.");
  });

  it("handles non-existent task deletion and updates with clear errors", async () => {
    const store = new TaskStore();
    const update = taskUpdateTool(store);
    const del = taskDeleteTool(store);

    assert.rejects(async () => {
      await del.execute({ id: "99" });
    }, /Task #99 not found/);

    assert.rejects(async () => {
      await update.execute({ id: "99", status: "completed" });
    }, /Task #99 not found/);
  });

  it("restores tasks and preserves auto-increment sequence beyond highest restored ID", () => {
    const store = new TaskStore();
    store.restore([
      {
        id: "5",
        subject: "Restored Task 5",
        status: "completed",
        createdAt: 1000,
        updatedAt: 2000,
      },
      {
        id: "12",
        subject: "Restored Task 12",
        status: "in_progress",
        createdAt: 1500,
        updatedAt: 2500,
      },
    ]);

    assert.strictEqual(store.list().length, 2);
    const newTask = store.create("Next Task");
    assert.strictEqual(newTask.id, "13");
  });
});

