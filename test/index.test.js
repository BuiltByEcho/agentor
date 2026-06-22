import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  buildReport,
  buildSummary,
  DEFAULT_PROXY,
  formatRuntimeError,
  getConfigPath,
  getTorSetupPlan,
  inspectTorSetup,
  loadConfig,
  makeOutputDir,
  parseArgs,
  parseTimeout,
  resolveRunOptions,
  runDoctor,
  runSession,
  setupTor,
  testTorRoute,
  VERSION
} from "../src/index.js";

test("parseArgs handles flags and positionals", () => {
  const parsed = parseArgs(["https://example.com", "--out", "tmp", "--json", "--no-proxy", "--install"]);
  assert.deepEqual(parsed._, ["https://example.com"]);
  assert.equal(parsed.flags.out, "tmp");
  assert.equal(parsed.flags.json, true);
  assert.equal(parsed.flags["no-proxy"], true);
  assert.equal(parsed.flags.install, true);
});

test("makeOutputDir creates a stable artifact-style path", () => {
  const dir = makeOutputDir("https://example.com/path?q=1", "artifacts", new Date("2026-05-20T12:34:56.000Z"));
  assert.match(dir.replaceAll(path.sep, "/"), /artifacts\/2026-05-20T12-34-56-000Z-example-com-path-q-1$/);
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

test("buildSummary includes proxy and artifacts", () => {
  const summary = buildSummary({
    command: "fetch",
    url: "https://example.com",
    title: "Example",
    proxy: DEFAULT_PROXY,
    outDir: "/tmp/run",
    artifacts: { html: "page.html", text: "page.txt", screenshot: null, report: null }
  });
  assert.match(summary, /proxied: yes/);
  assert.match(summary, /artifacts: page.html, page.txt/);
});

test("parseTimeout validates numeric input", () => {
  assert.equal(parseTimeout(undefined), 30000);
  assert.equal(parseTimeout("1500"), 1500);
  assert.throws(() => parseTimeout("wat"), /timeout must be a positive number/);
  assert.throws(() => parseTimeout("0"), /timeout must be a positive number/);
});

test("getConfigPath uses XDG-style path on macOS", () => {
  const configPath = getConfigPath("darwin", "/Users/test");
  assert.equal(configPath, "/Users/test/.config/agentor/config.json");
});

test("loadConfig returns empty config when missing", async () => {
  const missing = path.join(os.tmpdir(), `agentor-missing-${Date.now()}.json`);
  const config = await loadConfig(missing);
  assert.deepEqual(config, { defaultProfile: null, profiles: {} });
});

test("resolveRunOptions merges profile defaults", async () => {
  const options = await resolveRunOptions({
    flags: { profile: "tor-local" },
    config: {
      defaultProfile: null,
      profiles: {
        "tor-local": {
          proxy: "socks5://10.0.0.1:9050",
          timeout: 1234,
          baseDir: "named-runs",
          useProxy: true
        }
      }
    },
    command: "fetch"
  });
  assert.equal(options.proxy, "socks5://10.0.0.1:9050");
  assert.equal(options.timeoutMs, 1234);
  assert.equal(options.baseDir, "named-runs");
  assert.equal(options.profileName, "tor-local");
});

test("runSession writes receipt, summary, and artifacts without changing cwd", async () => {
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
  assert.match(await fs.readFile(path.join(tempDir, "summary.txt"), "utf8"), /proxied: no/);
});

test("formatRuntimeError makes proxy failures actionable", () => {
  const message = formatRuntimeError(
    new Error("page.goto: net::ERR_PROXY_CONNECTION_FAILED at https://example.com/"),
    { useProxy: true, proxy: "socks5://127.0.0.1:9050" }
  );
  assert.match(message, /Start Tor/);
  assert.match(message, /--no-proxy/);
});

test("getTorSetupPlan returns brew install flow on macOS", () => {
  const plan = getTorSetupPlan("darwin");
  assert.equal(plan.packageManager, "brew");
  assert.deepEqual(plan.installCommand, ["brew", "install", "tor"]);
});

test("inspectTorSetup reports ready when tor binary and port are available", async () => {
  const result = await inspectTorSetup({
    platform: "darwin",
    commandRunner: async (command) => ({ ok: command === "which", code: 0, stdout: "", stderr: "", error: null }),
    portChecker: async () => true
  });
  assert.equal(result.ready, true);
  assert.equal(result.portOpen, true);
  assert.equal(result.torBinary, true);
});

test("setupTor returns next steps when install is needed", async () => {
  const result = await setupTor({
    install: false,
    platform: "darwin",
    commandRunner: async (command, args = []) => {
      const joined = [command, ...args].join(" ");
      if (joined === "which brew") {
        return { ok: true, code: 0, stdout: "/opt/homebrew/bin/brew\n", stderr: "", error: null };
      }
      return { ok: false, code: 1, stdout: "", stderr: "", error: null };
    },
    portChecker: async () => false
  });
  assert.equal(result.ready, false);
  assert.match(result.nextSteps.join("\n"), /brew install tor/);
});

test("runDoctor reports check statuses", async () => {
  const result = await runDoctor({
    proxy: "socks5://127.0.0.1:9050",
    baseDir: path.join(os.tmpdir(), "agentor-doctor"),
    commandRunner: async () => ({ ok: false, code: 1, stdout: "", stderr: "", error: null }),
    portChecker: async () => false
  });
  assert.equal(result.checks.length, 4);
  assert.equal(result.checks.find((check) => check.name === "output-dir").ok, true);
});

test("testTorRoute returns formatted errors", async () => {
  const result = await testTorRoute({
    proxy: "socks5://127.0.0.1:9050",
    browserType: {
      launch: async () => {
        throw new Error("page.goto: net::ERR_PROXY_CONNECTION_FAILED at https://example.com/");
      }
    }
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /proxy connection failed/);
});
