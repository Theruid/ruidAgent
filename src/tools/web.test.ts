import { describe, it } from "node:test";
import assert from "node:assert";
import {
  htmlToMarkdown,
  decodeHtmlEntities,
  parseDuckDuckGoHtml,
  webSearchTool,
  webFetchTool,
} from "./web.js";
import { classifyToolRisk } from "../permissions.js";

describe("Web Tools: Search & Live Documentation Fetcher", () => {
  it("decodes HTML entities correctly", () => {
    const raw = "React &amp; TypeScript &lt;Components&gt; &quot;v5.8&quot; &#39;test&#39; &copy; 2026";
    const decoded = decodeHtmlEntities(raw);
    assert.strictEqual(decoded, 'React & TypeScript <Components> "v5.8" \'test\' © 2026');
  });

  it("converts HTML into clean Markdown and strips noise tags", () => {
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <style>.ad { color: red; }</style>
          <script>console.log("evil");</script>
        </head>
        <body>
          <nav><a href="/home">Home</a></nav>
          <header><h1>Site Header</h1></header>
          <main>
            <h1>TypeScript 5.8 Overview</h1>
            <p>TypeScript 5.8 introduces <strong>--erasableSyntaxOnly</strong>.</p>
            <pre><code class="typescript">const x: number = 42;\nconsole.log(x);</code></pre>
            <ul>
              <li>Enhanced return type checks</li>
              <li>Faster module resolution</li>
            </ul>
            <p>Read more at <a href="https://typescriptlang.org">Official Site</a>.</p>
          </main>
          <footer><p>Copyright 2026</p></footer>
        </body>
      </html>
    `;

    const markdown = htmlToMarkdown(html);

    // Strips script, style, nav, header, footer
    assert.doesNotMatch(markdown, /console\.log\("evil"\)/);
    assert.doesNotMatch(markdown, /Site Header/);
    assert.doesNotMatch(markdown, /Copyright 2026/);

    // Preserves headings, bold, code blocks, lists, links
    assert.match(markdown, /# TypeScript 5\.8 Overview/);
    assert.match(markdown, /\*\*--erasableSyntaxOnly\*\*/);
    assert.match(markdown, /```typescript\nconst x: number = 42;\nconsole\.log\(x\);\n```/);
    assert.match(markdown, /\* Enhanced return type checks/);
    assert.match(markdown, /\[Official Site\]\(https:\/\/typescriptlang\.org\)/);
  });

  it("parses DuckDuckGo HTML search results accurately", () => {
    const mockDdgHtml = `
      <div class="result results_links results_links_deep web-result">
        <div class="result__body">
          <h2 class="result__title">
            <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fdevblogs.microsoft.com%2Ftypescript%2Fannouncing-typescript-5-8%2F&rut=...">Announcing TypeScript 5.8</a>
          </h2>
          <a class="result__snippet" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fdevblogs.microsoft.com%2Ftypescript%2Fannouncing-typescript-5-8%2F">Today we are excited to announce the release of TypeScript 5.8!</a>
        </div>
      </div>
      <div class="result results_links results_links_deep web-result">
        <div class="result__body">
          <h2 class="result__title">
            <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.typescriptlang.org%2Fdocs%2Fhandbook%2Frelease-notes%2Ftypescript-5-8.html">TypeScript 5.8 Release Notes</a>
          </h2>
          <a class="result__snippet" href="...">Detailed reference for new flags and features in 5.8.</a>
        </div>
      </div>
    `;

    const results = parseDuckDuckGoHtml(mockDdgHtml, 5);

    assert.strictEqual(results.length, 2);
    assert.strictEqual(results[0].title, "Announcing TypeScript 5.8");
    assert.strictEqual(results[0].url, "https://devblogs.microsoft.com/typescript/announcing-typescript-5-8/");
    assert.strictEqual(results[0].snippet, "Today we are excited to announce the release of TypeScript 5.8!");
    assert.strictEqual(results[1].url, "https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-8.html");
  });

  it("classifies web_search and web_fetch as Tier 0 safe read-only tools", () => {
    assert.strictEqual(classifyToolRisk("web_search", { query: "react 19" }), 0);
    assert.strictEqual(classifyToolRisk("web_fetch", { url: "https://react.dev" }), 0);
  });

  it("validates schemas for web_search and web_fetch", () => {
    const searchTool = webSearchTool();
    assert.strictEqual(searchTool.schema.safeParse({ query: "ts 5.8" }).success, true);
    assert.strictEqual(searchTool.schema.safeParse({ query: "" }).success, false);

    const fetchTool = webFetchTool();
    assert.strictEqual(fetchTool.schema.safeParse({ url: "https://example.com" }).success, true);
    assert.strictEqual(fetchTool.schema.safeParse({ url: "invalid-url" }).success, false);
  });
});
