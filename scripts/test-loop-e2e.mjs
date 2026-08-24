import { runAgentLoop } from "../dist/agent/loop.js";
import { createOpenAIProvider } from "../dist/providers/openai.js";
import http from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Scripted model: turn 1 writes a file, turn 2 runs it via bash, turn 3 answers.
let requestCount = 0;
const script = [
  // turn 1 → write_file
  [
    { choices: [{ delta: { content: "I'll create the file." } }] },
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
                  arguments: '{"path":"hello.py","content":"print(\\"hello world\\")\\n"}',
                },
              },
            ],
          },
        },
      ],
    },
    { choices: [{ finish_reason: "tool_calls" }] },
  ],
  // turn 2 → bash to run it
  [
    {
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index: 0,
                id: "call_b1",
                function: { name: "bash", arguments: '{"command":"python hello.py"}' },
              },
            ],
          },
        },
      ],
    },
    { choices: [{ finish_reason: "tool_calls" }] },
  ],
  // turn 3 → final answer
  [
    { choices: [{ delta: { content: "Done! hello.py prints: hello world" } }] },
    { choices: [{ finish_reason: "stop" }] },
  ],
];

const seenRequests = [];
const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    seenRequests.push(JSON.parse(body));
    res.writeHead(200, { "content-type": "text/event-stream" });
    for (const c of script[Math.min(requestCount, script.length - 1)]) {
      res.write("data: " + JSON.stringify(c) + "\n\n");
    }
    res.end("data: [DONE]\n\n");
    requestCount++;
  });
});

await new Promise((r) => server.listen(0, r));
const port = server.address().port;

const wsRoot = mkdtempSync(join(tmpdir(), "agent-e2e-"));
process.env.OPENAI_API_KEY = "test";

const events = [];
const autoApprove = new Set(["read_file", "list_dir", "glob", "grep", "write_file", "bash"]);
const permissions = {
  async check(name) {
    return autoApprove.has(name);
  },
};

try {
  const provider = createOpenAIProvider({ type: "openai", baseUrl: `http://localhost:${port}/v1` });
  const messages = await runAgentLoop({
    provider,
    model: "scripted",
    workspaceRoot: wsRoot,
    initialPrompt: "create hello.py that prints hello world then run it",
    permissions,
    onEvent: (e) => events.push(e),
  });

  const toolStarts = events.filter((e) => e.type === "tool_start").map((e) => e.name);
  const results = events.filter((e) => e.type === "tool_result");
  const finalText = messages.at(-1)?.content?.[0]?.text ?? "";

  console.log("tool calls:", toolStarts.join(", "));
  console.log("all ok:", results.every((r) => !r.isError));
  console.log("final text:", finalText);
  console.log(
    "history shape:",
    messages.map((m) => `${m.role}[${m.content.map((c) => c.type).join(",")}]`).join(" → "),
  );

  const wrote = toolStarts.includes("write_file") && toolStarts.includes("bash");
  const noErrors = results.every((r) => !r.isError);
  const historyOk =
    messages.length === 6 && // user, asst(text+call), user(result), asst(call), user(result), asst(text)
    messages[2].content[0].type === "tool_result" &&
    messages[4].content[0].type === "tool_result";
  const wireOk =
    seenRequests[1]?.messages?.some((m) => m.role === "tool") === true; // OpenAI format check

  console.log("PASS tools ran:", wrote, "| PASS no errors:", noErrors, "| PASS history:", historyOk, "| PASS openai wire fmt:", wireOk);
} finally {
  server.close();
  try {
    rmSync(wsRoot, { recursive: true, force: true });
  } catch {}
}
