import { describe, it } from "node:test";
import assert from "node:assert";
import { MCPClient } from "./client.js";
import type { MCPServerConfig } from "../config.js";
import { classifyToolRisk } from "../permissions.js";
import { writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

  it("completes MCP JSON-RPC handshake, tool listing, and tool invocation over StdioTransport", async () => {
    // Create a mock MCP server script
    const scriptPath = join(tmpdir(), `mock-mcp-${Date.now()}.cjs`);
    const scriptCode = `
      const readline = require("readline");
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false });

      rl.on("line", (line) => {
        if (!line.trim()) return;
        try {
          const req = JSON.parse(line);
          if (req.method === "initialize") {
            process.stdout.write(JSON.stringify({
              jsonrpc: "2.0",
              id: req.id,
              result: {
                protocolVersion: "2024-11-05",
                capabilities: { tools: {} },
                serverInfo: { name: "mock-mcp", version: "1.0.0" }
              }
            }) + "\\n");
          } else if (req.method === "notifications/initialized") {
            // Notification has no response
          } else if (req.method === "tools/list") {
            process.stdout.write(JSON.stringify({
              jsonrpc: "2.0",
              id: req.id,
              result: {
                tools: [
                  {
                    name: "mock_echo",
                    description: "Echoes input back",
                    inputSchema: { type: "object", properties: { msg: { type: "string" } } }
                  },
                  {
                    name: "mock_fail",
                    description: "Returns an error",
                    inputSchema: { type: "object" }
                  }
                ]
              }
            }) + "\\n");
          } else if (req.method === "tools/call") {
            if (req.params.name === "mock_echo") {
              process.stdout.write(JSON.stringify({
                jsonrpc: "2.0",
                id: req.id,
                result: {
                  content: [{ type: "text", text: "ECHO: " + (req.params.arguments?.msg || "empty") }],
                  isError: false
                }
              }) + "\\n");
            } else if (req.params.name === "mock_fail") {
              process.stdout.write(JSON.stringify({
                jsonrpc: "2.0",
                id: req.id,
                result: {
                  content: [{ type: "text", text: "Operation deliberately failed" }],
                  isError: true
                }
              }) + "\\n");
            }
          }
        } catch (e) {}
      });
    `;

    writeFileSync(scriptPath, scriptCode, "utf8");

    const config: MCPServerConfig = {
      command: process.execPath,
      args: [scriptPath],
    };

    const client = new MCPClient("test_stdio_mcp", config);
    try {
      await client.connect();

      // Test tool discovery
      const tools = await client.listTools();
      assert.strictEqual(tools.length, 2);
      assert.strictEqual(tools[0].name, "mock_echo");
      assert.strictEqual(tools[1].name, "mock_fail");

      // Test tool call success
      const echoRes = await client.callTool("mock_echo", { msg: "Hello MCP!" });
      assert.strictEqual(echoRes.isError, false);
      assert.strictEqual(echoRes.content, "ECHO: Hello MCP!");

      // Test tool call error result
      const failRes = await client.callTool("mock_fail", {});
      assert.strictEqual(failRes.isError, true);
    } finally {
      await client.close();
      try {
        unlinkSync(scriptPath);
      } catch {}
    }
  });

  it("handles RPC error responses gracefully in callTool", async () => {
    const scriptPath = join(tmpdir(), `mock-mcp-err-${Date.now()}.cjs`);
    const scriptCode = `
      const readline = require("readline");
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false });

      rl.on("line", (line) => {
        if (!line.trim()) return;
        try {
          const req = JSON.parse(line);
          if (req.method === "initialize") {
            process.stdout.write(JSON.stringify({
              jsonrpc: "2.0",
              id: req.id,
              result: { protocolVersion: "2024-11-05", capabilities: {}, serverInfo: { name: "mock-err" } }
            }) + "\\n");
          } else if (req.method === "tools/call") {
            process.stdout.write(JSON.stringify({
              jsonrpc: "2.0",
              id: req.id,
              error: { code: -32601, message: "Method not found" }
            }) + "\\n");
          }
        } catch (e) {}
      });
    `;

    writeFileSync(scriptPath, scriptCode, "utf8");

    const config: MCPServerConfig = {
      command: process.execPath,
      args: [scriptPath],
    };

    const client = new MCPClient("test_err_mcp", config);
    try {
      await client.connect();
      const res = await client.callTool("unknown_tool", {});
      assert.strictEqual(res.isError, true);
      assert.ok(res.content.includes("Method not found") || res.content.includes("MCP Tool Call Failed"));
    } finally {
      await client.close();
      try {
        unlinkSync(scriptPath);
      } catch {}
    }
  });
});
