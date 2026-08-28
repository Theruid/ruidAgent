import { describe, it } from "node:test";
import assert from "node:assert";
import { fetchWithRetry, isRetryableError } from "./retry.js";
import http from "node:http";

describe("Retry Logic & HTTP Backoff", () => {
  it("classifies retryable errors", () => {
    assert.strictEqual(isRetryableError(null, 429), true);
    assert.strictEqual(isRetryableError(null, 500), true);
    assert.strictEqual(isRetryableError(null, 502), true);
    assert.strictEqual(isRetryableError(null, 503), true);
    assert.strictEqual(isRetryableError(null, 504), true);
    assert.strictEqual(isRetryableError(null, 529), true);
    assert.strictEqual(isRetryableError(null, 400), false);
    assert.strictEqual(isRetryableError(null, 401), false);
    assert.strictEqual(isRetryableError(null, 404), false);
  });

  it("retries on 503 and succeeds", async () => {
    let attempts = 0;
    const server = http.createServer((_req, res) => {
      attempts++;
      if (attempts < 3) {
        res.writeHead(503, { "Content-Type": "text/plain" });
        res.end("Temporary Overload");
      } else {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok" }));
      }
    });

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    const url = `http://127.0.0.1:${port}`;

    try {
      const res = await fetchWithRetry(url, { method: "GET" }, {
        maxRetries: 3,
        initialDelayMs: 20,
        maxDelayMs: 100,
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(attempts, 3);
    } finally {
      server.close();
    }
  });
});
