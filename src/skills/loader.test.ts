import { describe, it, beforeEach, afterEach } from "node:test";
import * as assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { SkillManager, parseSkillFrontmatter } from "./loader.js";

describe("SkillManager", () => {
  let tmpWs: string;
  let tmpGlobal: string;
  let manager: SkillManager;

  beforeEach(() => {
    tmpWs = fs.mkdtempSync(path.join(os.tmpdir(), "ruid-skill-ws-"));
    tmpGlobal = fs.mkdtempSync(path.join(os.tmpdir(), "ruid-skill-gl-"));
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

  it("parses YAML frontmatter and body", () => {
    const raw = `---
name: "deploy"
description: "Deploy the app to target env"
args: "<env>"
mode: auto
tags: ["ci", "release"]
---
Run npm run build then deploy to $ARG1.
`;
    const { frontmatter, body } = parseSkillFrontmatter(raw);
    assert.strictEqual(frontmatter.name, "deploy");
    assert.strictEqual(frontmatter.description, "Deploy the app to target env");
    assert.strictEqual(frontmatter.args, "<env>");
    assert.strictEqual(frontmatter.mode, "auto");
    assert.deepStrictEqual(frontmatter.tags, ["ci", "release"]);
    assert.strictEqual(body, "Run npm run build then deploy to $ARG1.");
  });

  it("discovers skills from workspace and global directories", async () => {
    // 1. Create global skill <name>.md
    fs.mkdirSync(tmpGlobal, { recursive: true });
    fs.writeFileSync(
      path.join(tmpGlobal, "lint.md"),
      `---
description: "Lint workspace"
---
Run npm run lint.
`
    );

    // 2. Create workspace skill <name>/SKILL.md
    const wsSkillDir = path.join(tmpWs, ".ruid", "skills", "deploy");
    fs.mkdirSync(wsSkillDir, { recursive: true });
    fs.writeFileSync(
      path.join(wsSkillDir, "SKILL.md"),
      `---
name: deploy
description: "Deploy to cloud"
args: "[stage]"
mode: plan
---
Review plan then deploy to $ARGS.
`
    );

    const skills = await manager.loadSkills();
    assert.strictEqual(skills.length, 2);

    const deploySkill = await manager.getSkill("deploy");
    assert.ok(deploySkill !== null);
    assert.strictEqual(deploySkill.scope, "workspace");
    assert.strictEqual(deploySkill.mode, "plan");

    const lintSkill = await manager.getSkill("lint");
    assert.ok(lintSkill !== null);
    assert.strictEqual(lintSkill.scope, "global");
  });

  it("workspace skill overrides global skill with same name", async () => {
    fs.mkdirSync(tmpGlobal, { recursive: true });
    fs.writeFileSync(
      path.join(tmpGlobal, "test.md"),
      `---
description: "Global Test"
---
Global test body.
`
    );

    const wsSkillDir = path.join(tmpWs, ".ruid", "skills");
    fs.mkdirSync(wsSkillDir, { recursive: true });
    fs.writeFileSync(
      path.join(wsSkillDir, "test.md"),
      `---
description: "Workspace Test"
---
Workspace test body.
`
    );

    const skill = await manager.getSkill("test");
    assert.ok(skill !== null);
    assert.strictEqual(skill.scope, "workspace");
    assert.strictEqual(skill.description, "Workspace Test");
  });

  it("renders arguments and substitutes $ARGS, $*, $ARG1", async () => {
    const wsSkillDir = path.join(tmpWs, ".ruid", "skills");
    fs.mkdirSync(wsSkillDir, { recursive: true });
    fs.writeFileSync(
      path.join(wsSkillDir, "review.md"),
      `---
description: "Review a PR"
args: "<branch> <focus>"
---
Check out branch $ARG1 and focus on $ARG2. Full args: $ARGS.
`
    );

    const skill = await manager.getSkill("review");
    assert.ok(skill !== null);

    const rendered = manager.renderSkill(skill, "feat-auth security");
    assert.strictEqual(
      rendered,
      "Check out branch feat-auth and focus on security. Full args: feat-auth security."
    );
  });

  it("formats system prompt XML block", async () => {
    const wsSkillDir = path.join(tmpWs, ".ruid", "skills");
    fs.mkdirSync(wsSkillDir, { recursive: true });
    fs.writeFileSync(
      path.join(wsSkillDir, "verify.md"),
      `---
description: "Run verification suite"
args: "[tier]"
mode: auto
---
Execute verification tests.
`
    );

    const skills = await manager.loadSkills();
    const promptXml = manager.formatSystemPromptSkills(skills);
    assert.ok(promptXml !== null);
    assert.ok(promptXml.includes("<available_skills>"));
    assert.ok(promptXml.includes("/verify (args: [tier]) [mode: auto]: Run verification suite"));
  });
});
