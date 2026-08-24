import http from "node:http";
import { listModels, createOpenAIProvider } from "../dist/providers/openai.js";

// Mock OpenAI-compatible server: /models + /chat/completions
const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    if (req.url === "/v1/models") {
      const auth = req.headers["authorization"];
      if (auth !== "Bearer sk-test-123") {
        res.writeHead(401, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: "bad key" } }));
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          object: "list",
          data: [
            { id: "model-b", object: "model" },
            { id: "model-a", object: "model" },
            { id: "model-a", object: "model" }, // duplicate to test dedupe
          ],
        }),
      );
      return;
    }
    if (req.url === "/v1/chat/completions") {
      // Echo back the model the client requested to verify it flows through
      const requested = JSON.parse(body).model;
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(
        "data: " +
          JSON.stringify({ choices: [{ delta: { content: `echo:${requested}` } }] }) +
          "\n\n",
      );
      res.end("data: [DONE]\n\n");
      return;
    }
    res.writeHead(404);
    res.end();
  });
});

await new Promise((r) => server.listen(0, r));
const port = server.address().port;
const base = `http://localhost:${port}/v1`;

let pass = true;

// 1. list models with key
const models = await listModels({ type: "openai", baseUrl: base, apiKey: "sk-test-123" });
console.log("models:", models.join(", "));
if (models.join(",") !== "model-a,model-b") {
  console.log("FAIL: expected sorted deduped [model-a,model-b]");
  pass = false;
} else console.log("PASS list+sort+dedupe");

// 2. list models without key on local base → allowed by the key check, but
// the mock still 401s it; wrap to show behavior clearly.
try {
  const noKey = await listModels({ type: "openai", baseUrl: base });
  console.log("PASS local-no-key listing allowed:", Array.isArray(noKey));
} catch (e) {
  console.log("note: mock requires a key even for localhost:", String(e).slice(0, 60));
}

// 3. bad key rejected
try {
  await listModels({ type: "openai", baseUrl: base, apiKey: "wrong" });
  console.log("FAIL: bad key accepted");
  pass = false;
} catch (e) {
  console.log("PASS bad key rejected:", String(e).slice(0, 60));
}

// 4. ad-hoc provider completes against custom endpoint
process.env.OPENAI_API_KEY = "";
const provider = createOpenAIProvider({ type: "openai", baseUrl: base, apiKey: "sk-test-123" });
let out = "";
for await (const e of provider.complete({
  system: "s",
  messages: [],
  tools: [],
  model: "model-a",
})) {
  if (e.type === "text_delta") out += e.text;
}
console.log("completion response:", out);
if (out !== "echo:model-a") {
  console.log("FAIL: model id did not flow through");
  pass = false;
} else console.log("PASS custom endpoint completion");

server.close();
console.log(pass ? "ALL PASS" : "FAILURES");
process.exit(pass ? 0 : 1);
