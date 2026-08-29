import { describe, it, beforeEach, afterEach } from "node:test";
import * as assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { SkillManager } from "../skills/loader.js";
import { skillRunTool } from "./skill.js";

describe("Skill Tools", () => {
  let tmpWs: string;
  let tmpGlobal: string;
  let manager: SkillManager;

  beforeEach(() => {
    tmpWs = fs.mkdtempSync(path.join(os.tmpdir(), "ruid-skill-tool-ws-"));
    tmpGlobal = fs.mkdtempSync(path.join(os.tmpdir(), "ruid-skill-tool-gl-"));
    manager = new SkillManager({
      workspaceRoot: tmpWs,
      globalDir: tmpGlobal,
    });
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpWs, { recursive: true, force: true });
      fs.rmSync(tmpGlobal, { recursive: true, force: true });
    } catch {}
  });

  it("executes skill tool and returns rendered instructions", async () => {
    const wsSkillDir = path.join(tmpWs, ".ruid", "skills");
    fs.mkdirSync(wsSkillDir, { recursive: true });
    fs.writeFileSync(
      path.join(wsSkillDir, "build.md"),
      `---
description: "Build project artifacts"
args: "[target]"
mode: auto
---
Compile TypeScript to $ARG1.
`
    );

    const tool = skillRunTool(manager);
    const result = await tool.execute({ name: "build", args: "dist" });

    assert.ok(result.includes("Loaded Skill: build"));
    assert.ok(result.includes("Mode: [AUTO]"));
    assert.ok(result.includes("Compile TypeScript to dist."));
  });

  it("handles missing skill gracefully with available list", async () => {
    const tool = skillRunTool(manager);
    const result = await tool.execute({ name: "non-existent" });
    assert.ok(result.includes('Skill "non-existent" not found.'));
  });
});
