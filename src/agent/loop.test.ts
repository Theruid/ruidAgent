import { describe, it } from "node:test";
import assert from "node:assert";
import { runAgentLoop, AgentLoopError, type LoopEvent } from "./loop.js";
import { createDeferredPermissions } from "../permissions.js";
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

      // Nothing was produced before the abort, so the caller's history comes back unchanged.
      const prior = [{ role: "user" as const, content: [{ type: "text" as const, text: "earlier" }] }];
      const messages = await runAgentLoop({
        provider,
        model: "gpt-4o",
        workspaceRoot: wsRoot,
        initialPrompt: "long task",
        messages: prior,
        signal: controller.signal,
      });
      assert.deepStrictEqual(messages, prior);
    } finally {
      server.close();
      try {
        rmSync(wsRoot, { recursive: true, force: true });
      } catch {}
    }
  });

  /** Serves one scripted response per request: SSE chunks, or an HTTP status to fail with. */
  async function scriptedServer(steps: Array<object[] | { status: number }>) {
    let requestCount = 0;
    const server = http.createServer((req, res) => {
      req.on("data", () => {});
      req.on("end", () => {
        const step = steps[Math.min(requestCount, steps.length - 1)];
        requestCount++;
        if (!Array.isArray(step)) {
          res.writeHead(step.status, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: { message: "bad request" } }));
          return;
        }
        res.writeHead(200, { "content-type": "text/event-stream" });
        for (const c of step) res.write("data: " + JSON.stringify(c) + "\n\n");
        res.end("data: [DONE]\n\n");
      });
    });
    await new Promise<void>((r) => server.listen(0, r));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    return {
      provider: createOpenAIProvider({ type: "openai", baseUrl: `http://localhost:${port}/v1`, apiKey: "test" }),
      requests: () => requestCount,
      close: () => server.close(),
    };
  }

  const toolCallStep = (id: string, name: string, args: object) => [
    {
      choices: [
        { delta: { tool_calls: [{ index: 0, id, function: { name, arguments: JSON.stringify(args) } }] } },
      ],
    },
    { choices: [{ finish_reason: "tool_calls" }] },
  ];

  it("Ctrl+C during a permission prompt ends the turn and keeps its history consistent", async () => {
    const srv = await scriptedServer([toolCallStep("call_w", "write_file", { path: "x.txt", content: "x" })]);
    const wsRoot = mkdtempSync(join(tmpdir(), "agent-loop-perm-abort-"));
    const perms = createDeferredPermissions(new Set(), "code");
    const controller = new AbortController();
    try {
      const messages = await runAgentLoop({
        provider: srv.provider,
        model: "scripted",
        workspaceRoot: wsRoot,
        initialPrompt: "write x",
        permissions: perms.manager,
        signal: controller.signal,
        onEvent: (e) => {
          if (e.type === "permission_request") {
            // What the TUI does on Ctrl+C.
            controller.abort();
            perms.cancelPending();
          }
        },
      });

      assert.strictEqual(srv.requests(), 1);
      assert.deepStrictEqual(messages.map((m) => m.role), ["user", "assistant", "user", "assistant"]);
      const result = messages[2].content[0];
      assert.ok(result.type === "tool_result" && result.isError);
      const note = messages[3].content[0];
      assert.ok(note.type === "text" && note.text.includes("interrupted"));
    } finally {
      srv.close();
      rmSync(wsRoot, { recursive: true, force: true });
    }
  });

  it("a provider error after tool work throws AgentLoopError carrying the history", async () => {
    const srv = await scriptedServer([toolCallStep("call_r", "list_dir", { path: "." }), { status: 400 }]);
    const wsRoot = mkdtempSync(join(tmpdir(), "agent-loop-err-"));
    const perms = createDeferredPermissions(new Set(), "code");
    const events: LoopEvent[] = [];
    try {
      const err = await runAgentLoop({
        provider: srv.provider,
        model: "scripted",
        workspaceRoot: wsRoot,
        initialPrompt: "look around",
        permissions: perms.manager,
        onEvent: (e) => events.push(e),
      }).then(
        () => null,
        (e) => e,
      );

      assert.ok(err instanceof AgentLoopError, `expected AgentLoopError, got ${err}`);
      assert.deepStrictEqual(err.messages.map((m: any) => m.role), ["user", "assistant", "user", "assistant"]);
      // list_dir is auto-approved, so no approval prompt was ever shown.
      assert.strictEqual(events.some((e) => e.type === "permission_request"), false);
    } finally {
      srv.close();
      rmSync(wsRoot, { recursive: true, force: true });
    }
  });

  it("a provider error before any output throws a plain Error", async () => {
    const srv = await scriptedServer([{ status: 400 }]);
    const wsRoot = mkdtempSync(join(tmpdir(), "agent-loop-err0-"));
    try {
      const err = await runAgentLoop({
        provider: srv.provider,
        model: "scripted",
        workspaceRoot: wsRoot,
        initialPrompt: "hi",
      }).then(
        () => null,
        (e) => e,
      );
      assert.ok(err instanceof Error);
      assert.ok(!(err instanceof AgentLoopError));
    } finally {
      srv.close();
      rmSync(wsRoot, { recursive: true, force: true });
    }
  });
});
