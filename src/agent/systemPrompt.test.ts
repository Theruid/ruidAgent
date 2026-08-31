import { describe, it } from "node:test";
import assert from "node:assert";
import { buildSystemPromptBlocks, buildSystemPrompt } from "./systemPrompt.js";
import { calculateCost } from "../ui/utils/pricing.js";

describe("Structured Context Layering & Ephemeral Caching", () => {
  it("generates structured XML prompt blocks with cacheControl on static base", () => {
    const blocks = buildSystemPromptBlocks("/workspace/app", "win32", "code");

    assert.strictEqual(blocks.length, 2);
    assert.strictEqual(blocks[0].cacheControl?.type, "ephemeral");
    assert.match(blocks[0].text, /<system>/);
    assert.match(blocks[0].text, /<agent_identity>/);
    assert.match(blocks[0].text, /You are RUID/);
    assert.match(blocks[0].text, /Config Precedence/);
    assert.match(blocks[0].text, /"mcpServers"/);
    assert.match(blocks[0].text, /Never search for, inspect, or edit third-party application configurations/);
    assert.match(blocks[0].text, /<guidelines>/);

    assert.match(blocks[1].text, /<environment>/);
    assert.match(blocks[1].text, /Workspace root: \/workspace\/app/);
    assert.match(blocks[1].text, /CURRENT MODE: CODE MODE/);
  });

  it("adjusts guidelines for plan mode", () => {
    const blocks = buildSystemPromptBlocks("/workspace/app", "linux", "plan");
    assert.match(blocks[1].text, /CURRENT MODE: PLAN MODE/);
    assert.match(blocks[1].text, /read-only architectural planning mode/);
  });

  it("adjusts guidelines for auto mode", () => {
    const blocks = buildSystemPromptBlocks("/workspace/app", "darwin", "auto");
    assert.match(blocks[1].text, /CURRENT MODE: AUTONOMOUS MODE/);
  });

  it("calculates pricing with ephemeral cache reads (0.1x) and creations (1.25x)", () => {
    const model = "claude-3-5-sonnet"; // Rates: $3/M in, $15/M out

    // Standard run: 1,000,000 in, 1,000,000 out => 3.0 + 15.0 = $18.00
    const costStandard = calculateCost(model, 1_000_000, 1_000_000, 0, 0);
    assert.strictEqual(Math.round(costStandard * 100) / 100, 18.0);

    // Cache read hit: 1,000,000 read tokens => 1.0 * (3.0 * 0.1) = $0.30
    const costCacheRead = calculateCost(model, 1_000_000, 0, 1_000_000, 0);
    assert.strictEqual(Math.round(costCacheRead * 100) / 100, 0.3);

    // Cache creation: 1,000,000 write tokens => 1.0 * (3.0 * 1.25) = $3.75
    const costCacheCreation = calculateCost(model, 1_000_000, 0, 0, 1_000_000);
    assert.strictEqual(costCacheCreation, 3.75);
  });

  it("injects memory and available skills blocks into dynamic block", () => {
    const blocks = buildSystemPromptBlocks({
      workspaceRoot: "/workspace/app",
      platform: "linux",
      mode: "code",
      memorySummary: "- [style] (feedback): Always use TypeScript strict mode",
      skillsListing: "<available_skills>\n- /deploy: Deploy app to cloud\n</available_skills>",
    });

    assert.strictEqual(blocks.length, 2);
    assert.match(blocks[1].text, /<memory>/);
    assert.match(blocks[1].text, /Always use TypeScript strict mode/);
    assert.match(blocks[1].text, /<available_skills>/);
    assert.match(blocks[1].text, /\/deploy: Deploy app to cloud/);
  });
});
