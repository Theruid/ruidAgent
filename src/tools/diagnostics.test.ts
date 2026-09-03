import { describe, it } from "node:test";
import assert from "node:assert";
import { checkFileSyntax } from "./diagnostics.js";

describe("Diagnostics & Syntax Verification (diagnostics.ts)", () => {
  it("passes valid TypeScript code without errors", () => {
    const validTs = `
      interface User {
        id: string;
        name: string;
      }
      export function greet(u: User): string {
        return \`Hello, \${u.name}\`;
      }
    `;
    const res = checkFileSyntax("src/greet.ts", validTs);
    assert.strictEqual(res.hasErrors, false);
    assert.strictEqual(res.messages.length, 0);
  });

  it("detects syntax errors in invalid TypeScript code", () => {
    const invalidTs = `
      export function broken( {
        const x = 123;
    `;
    const res = checkFileSyntax("src/broken.ts", invalidTs);
    assert.strictEqual(res.hasErrors, true);
    assert.ok(res.messages.length > 0);
    assert.ok(res.messages[0].includes("Line "));
  });

  it("passes valid TSX / React component code", () => {
    const validTsx = `
      import React from "react";
      export const Button = ({ label }: { label: string }) => {
        return <button className="btn">{label}</button>;
      };
    `;
    const res = checkFileSyntax("src/Button.tsx", validTsx);
    assert.strictEqual(res.hasErrors, false);
    assert.strictEqual(res.messages.length, 0);
  });

  it("detects unclosed JSX tags in TSX", () => {
    const invalidTsx = `
      import React from "react";
      export const Button = () => {
        return <div><span>unclosed</div>;
      };
    `;
    const res = checkFileSyntax("src/Button.tsx", invalidTsx);
    assert.strictEqual(res.hasErrors, true);
    assert.ok(res.messages.length > 0);
  });

  it("passes valid JavaScript and detects JS syntax errors", () => {
    const validJs = `
      function add(a, b) {
        return a + b;
      }
      module.exports = { add };
    `;
    const res1 = checkFileSyntax("index.cjs", validJs);
    assert.strictEqual(res1.hasErrors, false);

    const invalidJs = `
      function add(a, b) {
        return a + ;
      }
    `;
    const res2 = checkFileSyntax("index.mjs", invalidJs);
    assert.strictEqual(res2.hasErrors, true);
    assert.ok(res2.messages.length > 0);
  });

  it("ignores non-JS/TS files safely", () => {
    const json = `{ "foo": broken json `;
    const resJson = checkFileSyntax("data.json", json);
    assert.strictEqual(resJson.hasErrors, false);

    const py = `def broken_func(:\n  pass`;
    const resPy = checkFileSyntax("script.py", py);
    assert.strictEqual(resPy.hasErrors, false);

    const md = `# Heading\n[broken link`;
    const resMd = checkFileSyntax("README.md", md);
    assert.strictEqual(resMd.hasErrors, false);
  });

  it("caps reported diagnostic messages to maximum 3", () => {
    const multiErrors = `
      const a = ;
      const b = ;
      const c = ;
      const d = ;
      const e = ;
    `;
    const res = checkFileSyntax("bad.ts", multiErrors);
    assert.strictEqual(res.hasErrors, true);
    assert.ok(res.messages.length <= 3);
  });
});
