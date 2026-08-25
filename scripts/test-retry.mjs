import http from "node:http";
import assert from "node:assert";
import { fetchWithRetry } from "../dist/providers/retry.js";

async function testRetry() {
  let attempts = 0;
  const server = http.createServer((req, res) => {
    attempts++;
    if (attempts < 3) {
      res.writeHead(503, { "Content-Type": "text/plain" });
      res.end("Temporary Overload");
    } else {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
    }
  });

  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const url = `http://127.0.0.1:${port}`;

  try {
    const res = await fetchWithRetry(url, { method: "GET" }, {
      maxRetries: 3,
      initialDelayMs: 50,
      maxDelayMs: 200,
    });
    assert.strictEqual(res.status, 200, "Should successfully retry and receive 200 OK");
    assert.strictEqual(attempts, 3, "Should have attempted 3 times");
    console.log("PASS: fetchWithRetry retry logic verified");
  } finally {
    server.close();
  }
}

testRetry().catch((e) => {
  console.error("FAIL:", e);
  process.exit(1);
});
