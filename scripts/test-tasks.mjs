import assert from "node:assert";
import { TaskStore, taskCreateTool, taskUpdateTool, taskListTool } from "../dist/tools/tasks.js";

async function testTaskTools() {
  const store = new TaskStore();
  const create = taskCreateTool(store);
  const update = taskUpdateTool(store);
  const list = taskListTool(store);

  // 1. Initial list empty
  const emptyRes = await list.execute();
  assert.strictEqual(emptyRes, "No tasks tracked.");

  // 2. Create task
  const createRes = await create.execute({ subject: "Write unit tests", description: "Coverage > 90%" });
  assert(createRes.includes("Created task #1"), "Must create task #1");

  // 3. Update task
  const updateRes = await update.execute({ id: "1", status: "in_progress" });
  assert(updateRes.includes("[status: in_progress]"), "Must be in_progress");

  // 4. List tasks
  const listRes = await list.execute();
  assert(listRes.includes("#1 [in_progress] Write unit tests"), "List must contain updated task");

  // 5. Complete task
  await update.execute({ id: "1", status: "completed" });
  const completedList = await list.execute();
  assert(completedList.includes("#1 [completed]"), "Task must be marked completed");

  console.log("PASS: task management tools verified");
}

testTaskTools().catch((e) => {
  console.error("FAIL:", e);
  process.exit(1);
});
