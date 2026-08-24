import http from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Mock OpenAI-compatible endpoint
const server = http.createServer((req, res) => {
  if (req.url === "/v1/models") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ data: [{ id: "big-model" }, { id: "small-model" }] }));
    return;
  }
  res.writeHead(404);
  res.end();
});

// Paced feeding: Node >= 22 misbehaves when a full script is dumped into a
// piped stdin at once; humans type slower than 150ms/line anyway.
const fakeHome = mkdtempSync(join(tmpdir(), "setup-test-"));

server.listen(0, () => {
  const port = server.address().port;

  const child = spawn("node", ["dist/index.js", "setup"], {
    env: { ...process.env, USERPROFILE: fakeHome, HOME: fakeHome },
    stdio: ["pipe", "pipe", "pipe"],
  });

  let out = "";
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (out += d));

  const input = [
    "1", // add provider
    `http://localhost:${port}/v1`, // base url
    "sk-my-secret", // api key
    "myendpoint", // provider name
    "1", // model choice (big-model)
    "y", // make default
    "5", // exit
  ];
  let i = 0;
  const feed = setInterval(() => {
    if (i < input.length) {
      child.stdin.write(input[i++] + "\n");
    } else {
      clearInterval(feed);
      setTimeout(() => child.stdin.end(), 300);
    }
  }, 150);

  const timeout = setTimeout(finish, 25000);

  function finish() {
    clearTimeout(timeout);
    clearInterval(feed);
    console.log(out);

    let pass = true;
    let saved;
    try {
      saved = JSON.parse(readFileSync(join(fakeHome, ".codingagent", "config.json"), "utf8"));
      console.log("\nsaved config:", JSON.stringify(saved, null, 2));
    } catch (e) {
      console.log("\nFAIL: config not saved:", e.message);
      child.kill();
      server.close();
      process.exit(1);
    }

    if (saved.providers.myendpoint?.baseUrl !== `http://localhost:${port}/v1`) {
      console.log("FAIL: baseUrl not saved");
      pass = false;
    }
    if (saved.providers.myendpoint?.apiKey !== "sk-my-secret") {
      console.log("FAIL: apiKey not saved");
      pass = false;
    }
    if (saved.default.provider !== "myendpoint" || saved.default.model !== "big-model") {
      console.log("FAIL: default not set to myendpoint/big-model");
      pass = false;
    }
    console.log(pass ? "\nALL PASS" : "\nFAILURES");
    child.kill();
    server.close();
    process.exit(pass ? 0 : 1);
  }
});
