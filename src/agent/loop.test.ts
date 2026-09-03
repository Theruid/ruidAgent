import { describe, it } from "node:test";
import assert from "node:assert";
import { runAgentLoop, type LoopEvent } from "./loop.js";
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
      const events: LoopEvent[] = [];
      const messages = await runAgentLoop({
        provider,
        model: "scripted",
        workspaceRoot: wsRoot,
        initialPrompt: "write sample.txt",
        permissions,
        onEvent: (e) => events.push(e),
      });

      const toolStarts = events.filter((e) => e.type === "tool_start").map((e: any) => e.name);
      assert(toolStarts.includes("write_file"));
      assert(messages.length >= 3);
    } finally {
      server.close();
      try {
        rmSync(wsRoot, { recursive: true, force: true });
      } catch {}
    }
  });

  it("honors custom systemPrompt option override", async () => {
    let capturedSystemPrompt: string | undefined;

    const server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        try {
          const parsed = JSON.parse(body);
          capturedSystemPrompt = parsed.messages?.find((m: any) => m.role === "system")?.content;
        } catch {}
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write("data: " + JSON.stringify({ choices: [{ delta: { content: "Understood." }, finish_reason: "stop" }] }) + "\n\n");
        res.end("data: [DONE]\n\n");
      });
    });

    await new Promise<void>((r) => server.listen(0, r));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;

    const wsRoot = mkdtempSync(join(tmpdir(), "agent-loop-sysprompt-"));
    try {
      const provider = createOpenAIProvider({ type: "openai", baseUrl: `http://localhost:${port}/v1`, apiKey: "test" });
      await runAgentLoop({
        provider,
        model: "gpt-4o",
        workspaceRoot: wsRoot,
        initialPrompt: "Hello",
        systemPrompt: "CUSTOM_SYSTEM_PROMPT_RULE_12345",
      });

      assert.strictEqual(capturedSystemPrompt, "CUSTOM_SYSTEM_PROMPT_RULE_12345");
    } finally {
      server.close();
      try {
        rmSync(wsRoot, { recursive: true, force: true });
      } catch {}
    }
  });

  it("handles tool permission denial safely and emits permission_denied event", async () => {
    let requestCount = 0;
    const script = [
      [
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: "call_dangerous",
                    function: {
                      name: "bash",
                      arguments: '{"command":"rm -rf /"}',
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
        { choices: [{ delta: { content: "Understood, permission was denied." } }] },
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

    const wsRoot = mkdtempSync(join(tmpdir(), "agent-loop-denied-"));
    const denyAllPermissions = {
      async check() {
        return false; // Deny all tools
      },
      getMode: () => "code" as const,
      setMode: () => {},
      classifyRisk: () => 4 as const,
    };

    try {
      const provider = createOpenAIProvider({ type: "openai", baseUrl: `http://localhost:${port}/v1`, apiKey: "test" });
      const events: LoopEvent[] = [];
      const messages = await runAgentLoop({
        provider,
        model: "gpt-4o",
        workspaceRoot: wsRoot,
        initialPrompt: "run dangerous command",
        permissions: denyAllPermissions,
        onEvent: (e) => events.push(e),
      });

      const deniedEvent = events.find((e) => e.type === "permission_denied");
      assert.ok(deniedEvent);
      assert.strictEqual(deniedEvent.name, "bash");

      // Verify tool result recorded the denial
      const toolResultMsg = messages.find((m) =>
        m.role === "user" && Array.isArray(m.content) && m.content.some((c: any) => c.type === "tool_result" && c.isError && String(c.content).includes("Permission denied"))
      );
      assert.ok(toolResultMsg);
    } finally {
      server.close();
      try {
        rmSync(wsRoot, { recursive: true, force: true });
      } catch {}
    }
  });

  it("handles AbortSignal cancellation during execution", async () => {
    const server = http.createServer((req, res) => {
      // Hang response until aborted
      res.writeHead(200, { "content-type": "text/event-stream" });
    });

    await new Promise<void>((r) => server.listen(0, r));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;

    const wsRoot = mkdtempSync(join(tmpdir(), "agent-loop-abort-"));
    const controller = new AbortController();

    try {
      const provider = createOpenAIProvider({ type: "openai", baseUrl: `http://localhost:${port}/v1`, apiKey: "test" });

      // Abort after 50ms
      setTimeout(() => controller.abort(), 50);

      await assert.rejects(
        async () => {
          await runAgentLoop({
            provider,
            model: "gpt-4o",
            workspaceRoot: wsRoot,
            initialPrompt: "long task",
            signal: controller.signal,
          });
        },
        (err: any) => err?.name === "AbortError" || String(err).includes("abort") || String(err).includes("aborted")
      );
    } finally {
      server.close();
      try {
        rmSync(wsRoot, { recursive: true, force: true });
      } catch {}
    }
  });
});
