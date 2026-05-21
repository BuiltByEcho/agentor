import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildReport, formatRuntimeError, makeOutputDir, parseArgs, parseTimeout, runSession, VERSION } from "../src/index.js";

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

test("parseTimeout validates numeric input", () => {
  assert.equal(parseTimeout(undefined), 30000);
  assert.equal(parseTimeout("1500"), 1500);
  assert.throws(() => parseTimeout("wat"), /timeout must be a positive number/);
  assert.throws(() => parseTimeout("0"), /timeout must be a positive number/);
});

test("runSession writes receipt and artifacts without changing cwd", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "agentor-test-"));
  const originalCwd = process.cwd();
  const screenshotCalls = [];
  const mockPage = {
    goto: async () => {},
    evaluate: async () => ({
      title: "Mock",
      html: "<html><body><h1>Mock</h1></body></html>",
      text: "Mock body",
      links: [{ href: "https://example.com", text: "Example" }],
      headings: ["Mock"],
      description: "Mock description"
    }),
    screenshot: async ({ path: screenshotPath }) => {
      screenshotCalls.push(screenshotPath);
      await fs.writeFile(screenshotPath, "png");
    },
    setDefaultTimeout: () => {}
  };
  const mockBrowser = {
    newContext: async () => ({
      newPage: async () => mockPage,
      close: async () => {}
    }),
    close: async () => {}
  };
  const receipt = await runSession({
    command: "run",
    url: "https://example.com",
    outDir: tempDir,
    useProxy: false,
    prompt: "research this page",
    browserType: {
      launch: async () => mockBrowser
    }
  });
  assert.equal(process.cwd(), originalCwd);
  assert.equal(receipt.version, VERSION);
  assert.deepEqual(screenshotCalls, [path.join(tempDir, "screenshot.png")]);
  assert.equal(JSON.parse(await fs.readFile(path.join(tempDir, "receipt.json"), "utf8")).title, "Mock");
  assert.match(await fs.readFile(path.join(tempDir, "report.md"), "utf8"), /Mock description/);
});

test("formatRuntimeError makes proxy failures actionable", () => {
  const message = formatRuntimeError(
    new Error("page.goto: net::ERR_PROXY_CONNECTION_FAILED at https://example.com/"),
    { useProxy: true, proxy: "socks5://127.0.0.1:9050" }
  );
  assert.match(message, /Start Tor/);
  assert.match(message, /--no-proxy/);
});
