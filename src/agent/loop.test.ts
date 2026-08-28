import { describe, it } from "node:test";
import assert from "node:assert";
import { runAgentLoop } from "./loop.js";
import { createOpenAIProvider } from "../providers/openai.js";
import http from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("Agent Loop Execution (loop.ts)", () => {
  it("executes multi-turn tool call loop end-to-end", async () => {
    let requestCount = 0;
    const script = [
      [
        { choices: [{ delta: { content: "I will create a file." } }] },
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: "call_w1",
                    function: {
                      name: "write_file",
                      arguments: '{"path":"sample.txt","content":"hello loop\\n"}',
                    },
                  },
                ],
              },
            },
          ],
        },
        { choices: [{ finish_reason: "tool_calls" }] },
      ],
      [
        { choices: [{ delta: { content: "File created successfully." } }] },
        { choices: [{ finish_reason: "stop" }] },
      ],
    ];

    const server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        res.writeHead(200, { "content-type": "text/event-stream" });
        const step = script[Math.min(requestCount, script.length - 1)];
        for (const c of step) {
          res.write("data: " + JSON.stringify(c) + "\n\n");
        }
        res.end("data: [DONE]\n\n");
        requestCount++;
      });
    });

    await new Promise<void>((r) => server.listen(0, r));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;

    const wsRoot = mkdtempSync(join(tmpdir(), "agent-loop-test-"));
    const autoApprove = new Set(["read_file", "write_file", "edit_file"]);
    const permissions = {
      async check(name: string) {
        return autoApprove.has(name);
      },
      getMode: () => "auto" as const,
      setMode: () => {},
      classifyRisk: () => 1 as const,
    };

    try {
      const provider = createOpenAIProvider({ type: "openai", baseUrl: `http://localhost:${port}/v1`, apiKey: "test" });
      const events: any[] = [];
      const messages = await runAgentLoop({
        provider,
        model: "scripted",
        workspaceRoot: wsRoot,
        initialPrompt: "write sample.txt",
        permissions,
        onEvent: (e) => events.push(e),
      });

      const toolStarts = events.filter((e) => e.type === "tool_start").map((e) => e.name);
      assert(toolStarts.includes("write_file"));
      assert(messages.length >= 3);
    } finally {
      server.close();
      try {
        rmSync(wsRoot, { recursive: true, force: true });
      } catch {}
    }
  });
});
