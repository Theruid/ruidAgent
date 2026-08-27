import { describe, it } from "node:test";
import assert from "node:assert";
import { MCPClient } from "./client.js";
import type { MCPServerConfig } from "../config.js";
import { classifyToolRisk } from "../permissions.js";

describe("Model Context Protocol (MCP) Client & Security Boundary", () => {
  it("enforces untrusted Tier 3 risk tier by default for MCP tools", () => {
    const tier = classifyToolRisk("mcp__github__create_issue", { title: "Bug" });
    assert.strictEqual(tier, 3);
  });

  it("handles disabled MCP server configs safely without throwing", async () => {
    const config: MCPServerConfig = {
      command: "non_existent_binary",
      disabled: true,
    };

    const client = new MCPClient("test_server", config);
    await client.connect();

    const tools = await client.listTools();
    assert.deepStrictEqual(tools, []);
    await client.close();
  });

  it("rejects configuration without command or url", async () => {
    const config: MCPServerConfig = {};
    const client = new MCPClient("broken_server", config);

    await assert.rejects(
      async () => {
        await client.connect();
      },
      /must specify either command or url/
    );
  });
});
