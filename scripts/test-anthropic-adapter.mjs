import http from "node:http";
import { createAnthropicProvider } from "../dist/providers/anthropic.js";

const server = http.createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/event-stream" });
  const events = [
    { type: "message_start", message: { usage: { input_tokens: 12, output_tokens: 0 } } },
    { type: "content_block_start", index: 0, content_block: { type: "text" } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Checking" } },
    { type: "content_block_stop", index: 0 },
    {
      type: "content_block_start",
      index: 1,
      content_block: { type: "tool_use", id: "toolu_1", name: "read_file" },
    },
    {
      type: "content_block_delta",
      index: 1,
      delta: { type: "input_json_delta", partial_json: '{"path":"sr' },
    },
    {
      type: "content_block_delta",
      index: 1,
      delta: { type: "input_json_delta", partial_json: 'c/index.ts"}' },
    },
    { type: "content_block_stop", index: 1 },
    { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 9 } },
  ];
  for (const e of events) res.write("data: " + JSON.stringify(e) + "\n\n");
  res.end();
});

await new Promise((r) => server.listen(0, r));
const port = server.address().port;

process.env.ANTHROPIC_API_KEY = "test-key";
const provider = createAnthropicProvider({ type: "anthropic", baseUrl: `http://localhost:${port}` });
const events = [];
for await (const e of provider.complete({ system: "s", messages: [], tools: [], model: "test" })) {
  events.push(e);
}
console.log(JSON.stringify(events, null, 2));

const tc = events.find((e) => e.type === "tool_call");
console.log(
  "PASS tool_call:",
  !!tc && tc.name === "read_file" && tc.input.path === "src/index.ts",
);

server.close();
