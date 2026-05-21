#!/usr/bin/env node

import { parseArgs, runSession } from "./index.js";

function printUsage() {
  process.stdout.write(
    [
      "Usage:",
      "  agentor fetch <url> [--out <dir>] [--proxy <url>] [--no-proxy] [--timeout <ms>] [--json]",
      "  agentor screenshot <url> [--out <dir>] [--proxy <url>] [--no-proxy] [--timeout <ms>] [--json]",
      "  agentor run <url> [--prompt <text>] [--out <dir>] [--proxy <url>] [--no-proxy] [--timeout <ms>] [--json]"
    ].join("\n")
  );
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  if (!command || command === "--help" || command === "-h") {
    printUsage();
    process.exit(command ? 0 : 1);
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
    timeoutMs: parsed.flags.timeout ? Number(parsed.flags.timeout) : undefined,
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
