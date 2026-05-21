#!/usr/bin/env node

import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";
import {
  VERSION,
  buildSummary,
  getConfigPath,
  loadConfig,
  openPath,
  parseArgs,
  resolveProfile,
  resolveRunOptions,
  runDoctor,
  runSession,
  saveConfig,
  setupTor,
  testTorRoute
} from "./index.js";

function printUsage() {
  process.stdout.write(
    [
      "Usage:",
      "  agentor fetch <url> [--profile <name>] [--out <dir>] [--proxy <url>] [--no-proxy] [--timeout <ms>] [--json]",
      "  agentor shot <url> [--profile <name>] [--out <dir>] [--proxy <url>] [--no-proxy] [--timeout <ms>] [--json]",
      "  agentor screenshot <url> [--profile <name>] [--out <dir>] [--proxy <url>] [--no-proxy] [--timeout <ms>] [--json]",
      "  agentor research <url> [--profile <name>] [--prompt <text>] [--out <dir>] [--proxy <url>] [--no-proxy] [--timeout <ms>] [--json]",
      "  agentor run <url> [--profile <name>] [--prompt <text>] [--out <dir>] [--proxy <url>] [--no-proxy] [--timeout <ms>] [--json]",
      "  agentor setup tor [--install] [--start] [--yes] [--proxy <url>] [--json]",
      "  agentor test tor [--profile <name>] [--proxy <url>] [--url <url>] [--timeout <ms>] [--json]",
      "  agentor doctor [--profile <name>] [--proxy <url>] [--base-dir <dir>] [--json]",
      "  agentor demo [--json]",
      "  agentor open <run-dir>",
      "  agentor profile add <name> [--proxy <url>] [--base-dir <dir>] [--timeout <ms>] [--browser <path>] [--no-proxy]",
      "  agentor profile list",
      "  agentor profile use <name>",
      "  agentor profile remove <name>",
      "  agentor config show",
      "  agentor --version"
    ].join("\n") + "\n"
  );
}

function printOnboarding() {
  process.stdout.write(
    [
      "agenTOR start here:",
      "1. agentor setup tor",
      "2. agentor fetch https://example.com",
      "",
      "Use `agentor doctor` for a quick environment check."
    ].join("\n") + "\n"
  );
}

async function maybeConfirm(question, yesFlag) {
  if (yesFlag || !process.stdin.isTTY) {
    return yesFlag;
  }
  const rl = createInterface({ input, output });
  try {
    const answer = await rl.question(`${question} [y/N] `);
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

async function handleSetupTor(parsed) {
  const install = parsed.flags.install && await maybeConfirm("Install Tor now?", parsed.flags.yes);
  const start = parsed.flags.start && await maybeConfirm("Start Tor service now?", parsed.flags.yes);
  const result = await setupTor({
    install,
    start,
    proxy: parsed.flags.proxy
  });
  if (parsed.flags.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  if (result.ready) {
      process.stdout.write(`Tor is ready on ${result.host}:${result.port}\n`);
      return;
    }
    process.stdout.write([`Tor is not ready on ${result.host}:${result.port}.`, ...result.nextSteps].join("\n") + "\n");
}

async function handleTestTor(parsed, config) {
  const options = await resolveRunOptions({ flags: parsed.flags, config, command: "fetch" });
  const result = await testTorRoute({
    url: parsed.flags.url || "https://example.com",
    proxy: options.proxy,
    timeoutMs: options.timeoutMs,
    browserPath: options.browserPath
  });
  if (parsed.flags.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  process.stdout.write(result.ok ? `Tor route is live: ${result.title}\n` : `Tor route failed: ${result.error}\n`);
}

async function handleDoctor(parsed, config) {
  const profile = (() => {
    try {
      return resolveProfile(config, parsed.flags.profile);
    } catch {
      return null;
    }
  })();
  const result = await runDoctor({
    proxy: parsed.flags.proxy || profile?.proxy,
    baseDir: parsed.flags["base-dir"] || profile?.baseDir || "artifacts"
  });
  if (parsed.flags.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  const lines = result.checks.map((check) => `${check.ok ? "OK" : "FAIL"} ${check.name}: ${check.detail}`);
  process.stdout.write(`${lines.join("\n")}\n`);
}

async function handleProfile(action, rest, config, configPath) {
  if (action === "list") {
    const names = Object.keys(config.profiles);
    if (names.length === 0) {
      process.stdout.write("No profiles configured.\n");
      return;
    }
    process.stdout.write(
      `${names.map((name) => `${name}${config.defaultProfile === name ? " (default)" : ""}`).join("\n")}\n`
    );
    return;
  }
  const [name, ...profileRest] = rest;
  if (!name) {
    throw new Error(`missing profile name for profile ${action}`);
  }
  if (action === "use") {
    resolveProfile(config, name);
    config.defaultProfile = name;
    await saveConfig(config, configPath);
    process.stdout.write(`Default profile set to ${name}\n`);
    return;
  }
  if (action === "remove") {
    if (!config.profiles[name]) {
      throw new Error(`unknown profile: ${name}`);
    }
    delete config.profiles[name];
    if (config.defaultProfile === name) {
      config.defaultProfile = null;
    }
    await saveConfig(config, configPath);
    process.stdout.write(`Removed profile ${name}\n`);
    return;
  }
  if (action === "add") {
    const parsed = parseArgs(profileRest);
    config.profiles[name] = {
      proxy: parsed.flags.proxy,
      baseDir: parsed.flags["base-dir"],
      timeout: parsed.flags.timeout ? Number(parsed.flags.timeout) : undefined,
      browserPath: parsed.flags.browser,
      useProxy: parsed.flags["no-proxy"] ? false : true
    };
    await saveConfig(config, configPath);
    process.stdout.write(`Saved profile ${name}\n`);
    return;
  }
  throw new Error(`unknown profile action: ${action}`);
}

async function handleConfig(action, config, configPath) {
  if (action !== "show") {
    throw new Error("usage: agentor config show");
  }
  process.stdout.write(`${JSON.stringify({ path: configPath, ...config }, null, 2)}\n`);
}

async function handleRunLike(command, parsed, config) {
  const normalizedCommand = command === "shot" ? "screenshot" : command === "research" ? "run" : command;
  const url = parsed._?.[0];
  if (!url) {
    throw new Error("missing <url>");
  }
  const options = await resolveRunOptions({ flags: parsed.flags, config, command: normalizedCommand });
  const receipt = await runSession({
    ...options,
    url
  });
  if (parsed.flags.json) {
    process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
    return;
  }
  process.stdout.write(`${receipt.command} complete: ${receipt.outDir}\n${buildSummary(receipt)}\n`);
}

async function handleDemo(parsed, config) {
  const demoHtml = "data:text/html,<html><head><title>agenTOR Demo</title><meta name=\"description\" content=\"Demo page\"></head><body><h1>agenTOR</h1><a href=\"https://example.com\">Example</a><p>Demo route.</p></body></html>";
  const receipt = await runSession({
    ...(await resolveRunOptions({ flags: { ...parsed.flags, "no-proxy": true }, config, command: "run" })),
    command: "run",
    url: demoHtml,
    prompt: "research this page",
    useProxy: false
  });
  if (parsed.flags.json) {
    process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
    return;
  }
  process.stdout.write(`Demo complete: ${receipt.outDir}\n${buildSummary(receipt)}\n`);
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const configPath = getConfigPath();
  const config = await loadConfig(configPath);
  if (command === "--version" || command === "-v") {
    process.stdout.write(`${VERSION}\n`);
    return;
  }
  if (!command) {
    printOnboarding();
    return;
  }
  if (command === "--help" || command === "-h") {
    printUsage();
    return;
  }
  if (command === "setup") {
    const [target, ...setupRest] = rest;
    if (target !== "tor") {
      throw new Error("usage: agentor setup tor [--install] [--start] [--yes] [--proxy <url>] [--json]");
    }
    await handleSetupTor(parseArgs(setupRest));
    return;
  }
  if (command === "test") {
    const [target, ...testRest] = rest;
    if (target !== "tor") {
      throw new Error("usage: agentor test tor [--profile <name>] [--proxy <url>] [--url <url>] [--timeout <ms>] [--json]");
    }
    await handleTestTor(parseArgs(testRest), config);
    return;
  }
  if (command === "doctor") {
    await handleDoctor(parseArgs(rest), config);
    return;
  }
  if (command === "demo") {
    await handleDemo(parseArgs(rest), config);
    return;
  }
  if (command === "open") {
    const targetPath = rest[0];
    if (!targetPath) {
      throw new Error("usage: agentor open <run-dir>");
    }
    const result = await openPath(targetPath);
    if (!result.ok) {
      throw new Error(result.stderr || result.error?.message || "failed to open path");
    }
    process.stdout.write(`Opened ${targetPath}\n`);
    return;
  }
  if (command === "profile") {
    const [action, ...profileRest] = rest;
    await handleProfile(action, profileRest, config, configPath);
    return;
  }
  if (command === "config") {
    const [action] = rest;
    await handleConfig(action, config, configPath);
    return;
  }
  if (!["fetch", "shot", "screenshot", "research", "run"].includes(command)) {
    throw new Error(`unknown command: ${command}`);
  }
  await handleRunLike(command, parseArgs(rest), config);
}

main().catch((error) => {
  process.stderr.write(`agentor: ${error.message}\n`);
  process.exit(1);
});
