import { describe, it } from "node:test";
import assert from "node:assert";
import { calculateCost, formatTokenCount, formatCost, formatLatency } from "./pricing.js";

describe("Pricing & Token Formatting Utilities (pricing.ts)", () => {
  it("calculates cost accurately for Anthropic Claude Sonnet 4 / 5", () => {
    // Sonnet rates: [3.0, 15.0] USD / M tokens
    const cost = calculateCost("claude-sonnet-4", 1_000_000, 1_000_000);
    assert.strictEqual(cost, 18.0);
  });

  it("calculates prompt cache read discounts (0.1x) and cache creation (1.25x)", () => {
    // For claude-3-7-sonnet rates: [3.0, 15.0]
    // 1M base input = $3.0
    // 1M cache read = 1M * (3.0 * 0.1) = $0.30
    // 1M cache creation = 1M * (3.0 * 1.25) = $3.75
    // 1M output = $15.0
    // Total input = 3M (1M base + 1M cacheRead + 1M cacheCreation)
    const cost = calculateCost("claude-3-7-sonnet", 3_000_000, 1_000_000, 1_000_000, 1_000_000);
    assert.strictEqual(Math.round(cost * 100) / 100, 22.05);
  });

  it("calculates cost for OpenAI models (GPT-4o, mini, o1, o3-mini)", () => {
    // gpt-4o-mini rates: [0.15, 0.6] USD / M
    const miniCost = calculateCost("gpt-4o-mini", 1_000_000, 1_000_000);
    assert.strictEqual(miniCost, 0.75);

    // o1 rates: [15.0, 60.0] USD / M
    const o1Cost = calculateCost("o1-preview", 100_000, 100_000);
    assert.strictEqual(o1Cost, 7.5);
  });

  it("calculates cost for DeepSeek and open weight models", () => {
    // deepseek-r1 rates: [0.55, 2.19]
    const dsCost = calculateCost("deepseek-r1", 1_000_000, 1_000_000);
    assert.strictEqual(dsCost, 0.55 + 2.19);
  });

  it("falls back to default rates for unknown models", () => {
    // default rates: [2.5, 10.0]
    const defCost = calculateCost("custom-unknown-model", 1_000_000, 1_000_000);
    assert.strictEqual(defCost, 12.5);
  });

  it("formats token counts properly", () => {
    assert.strictEqual(formatTokenCount(450), "450");
    assert.strictEqual(formatTokenCount(1000), "1k");
    assert.strictEqual(formatTokenCount(4200), "4.2k");
    assert.strictEqual(formatTokenCount(15000), "15k");
    assert.strictEqual(formatTokenCount(1_200_000), "1.20M");
    assert.strictEqual(formatTokenCount(2_000_000), "2M");
  });

  it("formats USD cost correctly", () => {
    assert.strictEqual(formatCost(0), "$0.00");
    assert.strictEqual(formatCost(-0.5), "$0.00");
    assert.strictEqual(formatCost(0.002), "<$0.01");
    assert.strictEqual(formatCost(0.05), "~$0.05");
    assert.strictEqual(formatCost(1.234), "~$1.23");
  });

  it("formats latency duration correctly", () => {
    assert.strictEqual(formatLatency(420), "420ms");
    assert.strictEqual(formatLatency(999), "999ms");
    assert.strictEqual(formatLatency(1500), "1.5s");
    assert.strictEqual(formatLatency(12300), "12.3s");
  });
});
