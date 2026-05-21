#!/usr/bin/env node

import { VERSION, parseArgs, parseTimeout, runSession, setupTor } from "./index.js";

function printUsage() {
  process.stdout.write(
    [
      "Usage:",
      "  agentor fetch <url> [--out <dir>] [--proxy <url>] [--no-proxy] [--timeout <ms>] [--json]",
      "  agentor screenshot <url> [--out <dir>] [--proxy <url>] [--no-proxy] [--timeout <ms>] [--json]",
      "  agentor run <url> [--prompt <text>] [--out <dir>] [--proxy <url>] [--no-proxy] [--timeout <ms>] [--json]",
      "  agentor setup tor [--install] [--proxy <url>] [--json]"
    ].join("\n")
  );
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  if (command === "--version" || command === "-v") {
    process.stdout.write(`${VERSION}\n`);
    return;
  }
  if (!command || command === "--help" || command === "-h") {
    printUsage();
    process.exit(command ? 0 : 1);
  }
  if (command === "setup") {
    const [target, ...setupRest] = rest;
    if (target !== "tor") {
      throw new Error("usage: agentor setup tor [--install] [--proxy <url>] [--json]");
    }
    const parsed = parseArgs(setupRest);
    const result = await setupTor({
      install: Boolean(parsed.flags.install),
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
    process.stdout.write(
      [
        `Tor is not ready on ${result.host}:${result.port}.`,
        ...result.nextSteps
      ].join("\n")
    );
    return;
  }
  if (!["fetch", "screenshot", "run"].includes(command)) {
    throw new Error(`unknown command: ${command}`);
  }
  const parsed = parseArgs(rest);
  const url = parsed._?.[0];
  if (!url) {
    throw new Error("missing <url>");
  }
  const receipt = await runSession({
    command,
    url,
    outDir: parsed.flags.out,
    proxy: parsed.flags.proxy,
    useProxy: !parsed.flags["no-proxy"],
    timeoutMs: parseTimeout(parsed.flags.timeout),
    prompt: parsed.flags.prompt
  });
  if (parsed.flags.json) {
    process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
    return;
  }
  process.stdout.write(`${receipt.command} complete: ${receipt.outDir}\n`);
}

main().catch((error) => {
  process.stderr.write(`agentor: ${error.message}\n`);
  process.exit(1);
});
