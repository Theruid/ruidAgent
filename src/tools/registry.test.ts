import { describe, it } from "node:test";
import assert from "node:assert";
import { Workspace } from "./fs.js";
import { buildRegistry, dispatch, toToolDefs } from "./registry.js";

describe("Tool Registry & Dispatch Engine", () => {
  const ws = new Workspace(process.cwd());

  it("builds registry with options object signature", async () => {
    const registry = await buildRegistry({ workspace: ws });
    assert(registry.has("read_file"));
    assert(registry.has("write_file"));
    assert(registry.has("edit_file"));
    assert(registry.has("bash"));
    assert(registry.has("git_status"));
    assert(registry.has("rollback"));
  });

  it("converts registry to tool definition array", async () => {
    const registry = await buildRegistry({ workspace: ws });
    const defs = toToolDefs(registry);
    assert(defs.some((d) => d.name === "read_file"));
    assert(defs.some((d) => d.name === "bash"));
  });

  it("dispatches unknown tools with helpful error", async () => {
    const registry = await buildRegistry({ workspace: ws });
    const result = await dispatch(registry, "non_existent_tool_xyz", {});
    assert.strictEqual(result.isError, true);
    assert(result.content.includes('Unknown tool "non_existent_tool_xyz"'));
  });

  it("handles schema validation errors gracefully", async () => {
    const registry = await buildRegistry({ workspace: ws });
    const result = await dispatch(registry, "read_file", {}); // missing path
    assert.strictEqual(result.isError, true);
    assert(result.content.includes("Invalid arguments for read_file"));
  });
});
