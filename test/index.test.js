import test from "node:test";
import assert from "node:assert/strict";
import { buildReport, makeOutputDir, parseArgs } from "../src/index.js";

test("parseArgs handles flags and positionals", () => {
  const parsed = parseArgs(["https://example.com", "--out", "tmp", "--json", "--no-proxy"]);
  assert.deepEqual(parsed._, ["https://example.com"]);
  assert.equal(parsed.flags.out, "tmp");
  assert.equal(parsed.flags.json, true);
  assert.equal(parsed.flags["no-proxy"], true);
});

test("makeOutputDir creates a stable artifact-style path", () => {
  const dir = makeOutputDir("https://example.com/path?q=1", "artifacts", new Date("2026-05-20T12:34:56.000Z"));
  assert.match(dir, /artifacts\/2026-05-20T12-34-56-000Z-example-com-path-q-1$/);
});

test("buildReport includes title, prompt, and links", () => {
  const report = buildReport(
    {
      title: "agenTOR",
      url: "https://example.com",
      description: "Test page",
      text: "This is a longish body for the report generator.",
      headings: ["Top", "Details"],
      links: [{ href: "https://example.com/docs", text: "Docs" }]
    },
    "research this page"
  );
  assert.match(report, /# agenTOR Report/);
  assert.match(report, /Prompt: research this page/);
  assert.match(report, /Docs <https:\/\/example.com\/docs>/);
});
