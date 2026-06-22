import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { chromium } from "playwright-core";

export const VERSION = "0.1.1";
export const DEFAULT_PROXY = "socks5://127.0.0.1:9050";
export const DEFAULT_TIMEOUT_MS = 30_000;
export const DEFAULT_VIEWPORT = { width: 1440, height: 900 };
const DEFAULT_PROXY_HOST = "127.0.0.1";
const DEFAULT_PROXY_PORT = 9050;
const LOCAL_BROWSER_CANDIDATES = [
  process.env.AGENTOR_BROWSER_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"
].filter(Boolean);

function slugifyUrl(input) {
  const safe = input
    .replace(/^[a-z]+:\/\//i, "")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return safe.slice(0, 64) || "session";
}

function timestampStamp(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, "-");
}

export function makeOutputDir(url, baseDir = "artifacts", now = new Date()) {
  return path.resolve(baseDir, `${timestampStamp(now)}-${slugifyUrl(url)}`);
}

export function getConfigPath(platform = process.platform, homeDir = os.homedir()) {
  if (platform === "win32") {
    const appData = process.env.APPDATA || path.join(homeDir, "AppData", "Roaming");
    return path.join(appData, "agentor", "config.json");
  }
  return path.posix.join(homeDir, ".config", "agentor", "config.json");
}

export async function loadConfig(configPath = getConfigPath()) {
  try {
    const raw = await fs.readFile(configPath, "utf8");
    const parsed = JSON.parse(raw);
    return {
      defaultProfile: parsed.defaultProfile || null,
      profiles: parsed.profiles || {}
    };
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return { defaultProfile: null, profiles: {} };
    }
    throw error;
  }
}

export async function saveConfig(config, configPath = getConfigPath()) {
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
  return configPath;
}

export function resolveProfile(config, name) {
  const profileName = name || config.defaultProfile;
  if (!profileName) {
    return null;
  }
  const profile = config.profiles?.[profileName];
  if (!profile) {
    throw new Error(`unknown profile: ${profileName}`);
  }
  return { name: profileName, ...profile };
}

export function parseArgs(argv) {
  const args = [...argv];
  const result = { flags: {} };
  const booleanFlags = new Set(["json", "no-proxy", "install", "yes", "start"]);
  while (args.length > 0) {
    const token = args.shift();
    if (!token.startsWith("--")) {
      result._ = result._ || [];
      result._.push(token);
      continue;
    }
    const key = token.slice(2);
    if (booleanFlags.has(key)) {
      result.flags[key] = true;
      continue;
    }
    const value = args.shift();
    if (value === undefined) {
      throw new Error(`missing value for --${key}`);
    }
    result.flags[key] = value;
  }
  return result;
}

export function parseTimeout(value) {
  if (value === undefined) {
    return DEFAULT_TIMEOUT_MS;
  }
  const timeoutMs = Number(value);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error("timeout must be a positive number of milliseconds");
  }
  return timeoutMs;
}

function splitProxyAddress(proxy = DEFAULT_PROXY) {
  const parsed = new URL(proxy);
  return {
    host: parsed.hostname || DEFAULT_PROXY_HOST,
    port: parsed.port ? Number(parsed.port) : DEFAULT_PROXY_PORT
  };
}

function clip(value, max) {
  return value.length <= max ? value : `${value.slice(0, max - 1)}...`;
}

export function buildReport(snapshot, prompt = "research this page") {
  const headline = snapshot.title || snapshot.url;
  const summary = snapshot.description || "No meta description found.";
  const topLinks = snapshot.links.slice(0, 8).map((link) => `- ${link.text || link.href} <${link.href}>`);
  const topHeadings = snapshot.headings.slice(0, 10).map((heading) => `- ${heading}`);
  const topFacts = [
    `Prompt: ${prompt}`,
    `Title: ${headline}`,
    `URL: ${snapshot.url}`,
    `Description: ${summary}`,
    `Body excerpt: ${clip(snapshot.text.replace(/\s+/g, " ").trim(), 500)}`
  ];
  return [
    "# agenTOR Report",
    "",
    ...topFacts,
    "",
    "## Headings",
    ...(topHeadings.length > 0 ? topHeadings : ["- None found"]),
    "",
    "## Links",
    ...(topLinks.length > 0 ? topLinks : ["- None found"])
  ].join("\n");
}

export function buildSummary(receipt) {
  return [
    `command: ${receipt.command}`,
    `url: ${receipt.url}`,
    `title: ${receipt.title || "(none)"}`,
    `proxied: ${receipt.proxy ? "yes" : "no"}`,
    `proxy: ${receipt.proxy || "(direct)"}`,
    `artifacts: ${Object.values(receipt.artifacts).filter(Boolean).join(", ")}`,
    `outDir: ${receipt.outDir}`
  ].join("\n");
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

export async function resolveBrowserLaunchOptions() {
  for (const candidate of LOCAL_BROWSER_CANDIDATES) {
    try {
      await fs.access(candidate);
      return { executablePath: candidate };
    } catch {
      continue;
    }
  }
  return {};
}

export async function inspectBrowser() {
  const launchOptions = await resolveBrowserLaunchOptions();
  return {
    available: Boolean(launchOptions.executablePath),
    executablePath: launchOptions.executablePath || null
  };
}

async function writeJson(file, value) {
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

async function capturePage(page, url, mode, outDir) {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  const snapshot = await page.evaluate(() => {
    const text = document.body?.innerText || "";
    const links = Array.from(document.querySelectorAll("a[href]")).map((anchor) => ({
      href: anchor.href,
      text: (anchor.textContent || "").trim().replace(/\s+/g, " ")
    }));
    const headings = Array.from(document.querySelectorAll("h1,h2,h3"))
      .map((heading) => (heading.textContent || "").trim().replace(/\s+/g, " "))
      .filter(Boolean);
    const description = document.querySelector('meta[name="description"]')?.getAttribute("content") || "";
    return {
      title: document.title || "",
      html: document.documentElement.outerHTML,
      text,
      links,
      headings,
      description
    };
  });
  if (mode === "screenshot" || mode === "run") {
    await page.screenshot({ path: path.join(outDir, "screenshot.png") });
  }
  return snapshot;
}

export async function runCommand(command, args = [], options = {}) {
  return await new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      ...options
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      resolve({ ok: false, code: null, stdout, stderr, error });
    });
    child.on("close", (code) => {
      resolve({ ok: code === 0, code, stdout, stderr, error: null });
    });
  });
}

export async function isTcpPortOpen(host, port, timeoutMs = 750) {
  return await new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    const finish = (value) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

async function commandExists(command, commandRunner = runCommand, platform = process.platform) {
  const probe = platform === "win32"
    ? await commandRunner("where", [command])
    : await commandRunner("which", [command]);
  return probe.ok;
}

export function getTorSetupPlan(platform = process.platform) {
  if (platform === "darwin") {
    return {
      platform,
      packageManager: "brew",
      installCommand: ["brew", "install", "tor"],
      startCommand: ["brew", "services", "start", "tor"],
      startExamples: ["brew services start tor", "tor"]
    };
  }
  if (platform === "linux") {
    return {
      platform,
      packageManager: "apt",
      installCommand: ["sudo", "apt-get", "install", "-y", "tor"],
      startCommand: ["sudo", "systemctl", "start", "tor"],
      startExamples: ["sudo systemctl start tor", "tor"]
    };
  }
  if (platform === "win32") {
    return {
      platform,
      packageManager: "winget",
      installCommand: ["winget", "install", "--id", "TorProject.TorBrowser", "-e"],
      startCommand: null,
      startExamples: ["Start Tor Browser or a Tor expert bundle so SOCKS is listening on 127.0.0.1:9050"]
    };
  }
  return {
    platform,
    packageManager: null,
    installCommand: null,
    startCommand: null,
    startExamples: ["Install Tor manually and expose a SOCKS proxy on 127.0.0.1:9050"]
  };
}

export async function inspectTorSetup({
  proxy = DEFAULT_PROXY,
  platform = process.platform,
  commandRunner = runCommand,
  portChecker = isTcpPortOpen
} = {}) {
  const plan = getTorSetupPlan(platform);
  const { host, port } = splitProxyAddress(proxy);
  const portOpen = await portChecker(host, port);
  const torBinary = await commandExists("tor", commandRunner, platform);
  const packageManagerAvailable = plan.installCommand
    ? await commandExists(plan.installCommand[0], commandRunner, platform)
    : false;
  return {
    proxy,
    host,
    port,
    platform,
    torBinary,
    portOpen,
    ready: torBinary && portOpen,
    packageManager: plan.packageManager,
    packageManagerAvailable,
    installCommand: plan.installCommand,
    startCommand: plan.startCommand,
    startExamples: plan.startExamples
  };
}

export async function setupTor({
  install = false,
  start = false,
  proxy = DEFAULT_PROXY,
  platform = process.platform,
  commandRunner = runCommand,
  portChecker = isTcpPortOpen
} = {}) {
  const before = await inspectTorSetup({ proxy, platform, commandRunner, portChecker });
  let installAttempted = false;
  let installResult = null;
  let startAttempted = false;
  let startResult = null;
  if (!before.ready && install && !before.torBinary && before.installCommand && before.packageManagerAvailable) {
    installAttempted = true;
    installResult = await commandRunner(before.installCommand[0], before.installCommand.slice(1), {
      stdio: ["inherit", "pipe", "pipe"]
    });
  }
  const mid = installAttempted
    ? await inspectTorSetup({ proxy, platform, commandRunner, portChecker })
    : before;
  if (!mid.ready && start && mid.torBinary && mid.startCommand) {
    startAttempted = true;
    startResult = await commandRunner(mid.startCommand[0], mid.startCommand.slice(1), {
      stdio: ["inherit", "pipe", "pipe"]
    });
  }
  const after = startAttempted
    ? await inspectTorSetup({ proxy, platform, commandRunner, portChecker })
    : mid;
  return {
    ...after,
    installAttempted,
    installResult,
    startAttempted,
    startResult,
    nextSteps: after.ready
      ? []
      : [
          !after.torBinary
            ? after.installCommand && after.packageManagerAvailable
              ? `install Tor with: ${after.installCommand.join(" ")}`
              : "install Tor manually"
            : null,
          after.torBinary && !after.portOpen
            ? `start Tor so SOCKS is listening on ${after.host}:${after.port}`
            : null,
          ...after.startExamples.map((command) => `example: ${command}`)
        ].filter(Boolean)
  };
}

export async function verifyWritableDir(dir) {
  const resolved = path.resolve(dir);
  await fs.mkdir(resolved, { recursive: true });
  const probe = path.join(resolved, `.agentor-write-${process.pid}-${Date.now()}`);
  await fs.writeFile(probe, "ok\n");
  await fs.unlink(probe);
  return resolved;
}

export function formatRuntimeError(error, { useProxy, proxy }) {
  const message = error instanceof Error ? error.message : String(error);
  if (useProxy && /ERR_PROXY_CONNECTION_FAILED|proxy connection failed/i.test(message)) {
    return `proxy connection failed for ${proxy}. Start Tor on 127.0.0.1:9050, provide --proxy <url>, or retry with --no-proxy.`;
  }
  if (/Executable doesn't exist|browserType\.launch/i.test(message)) {
    return "no compatible browser executable was found. Install Chrome/Chromium or set AGENTOR_BROWSER_PATH.";
  }
  return message;
}

export async function resolveRunOptions({
  flags = {},
  config = { defaultProfile: null, profiles: {} },
  command
}) {
  const profile = resolveProfile(config, flags.profile);
  const baseDir = flags.baseDir || profile?.baseDir || "artifacts";
  const useProxy = flags["no-proxy"] ? false : profile?.useProxy !== false;
  return {
    command,
    url: null,
    outDir: flags.out,
    baseDir,
    proxy: flags.proxy || profile?.proxy || DEFAULT_PROXY,
    useProxy,
    timeoutMs: parseTimeout(flags.timeout ?? profile?.timeout),
    prompt: flags.prompt || profile?.prompt,
    browserPath: flags.browser || profile?.browserPath || null,
    profileName: profile?.name || null
  };
}

export async function runSession({
  command,
  url,
  outDir,
  baseDir = "artifacts",
  proxy = DEFAULT_PROXY,
  useProxy = true,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  prompt,
  browserType = chromium,
  browserPath = null,
  profileName = null
}) {
  const resolvedOutDir = outDir || makeOutputDir(url, baseDir);
  await ensureDir(resolvedOutDir);
  const detectedLaunchOptions = await resolveBrowserLaunchOptions();
  const launchOptions = browserPath
    ? { executablePath: browserPath }
    : detectedLaunchOptions;
  let browser;
  try {
    browser = await browserType.launch({
      headless: true,
      ...launchOptions,
      proxy: useProxy ? { server: proxy } : undefined
    });
  } catch (error) {
    throw new Error(formatRuntimeError(error, { useProxy, proxy }));
  }
  const startedAt = new Date().toISOString();
  try {
    const context = await browser.newContext({ viewport: DEFAULT_VIEWPORT });
    const page = await context.newPage();
    page.setDefaultTimeout(timeoutMs);
    let snapshot;
    try {
      snapshot = await capturePage(page, url, command, resolvedOutDir);
    } catch (error) {
      throw new Error(formatRuntimeError(error, { useProxy, proxy }));
    }
    await fs.writeFile(path.join(resolvedOutDir, "page.html"), snapshot.html);
    await fs.writeFile(path.join(resolvedOutDir, "page.txt"), `${snapshot.text.trim()}\n`);
    if (command === "run") {
      await fs.writeFile(path.join(resolvedOutDir, "report.md"), `${buildReport({ ...snapshot, url }, prompt)}\n`);
    }
    const receipt = {
      tool: "agentor",
      version: VERSION,
      command,
      url,
      prompt: prompt || null,
      proxy: useProxy ? proxy : null,
      startedAt,
      finishedAt: new Date().toISOString(),
      outDir: resolvedOutDir,
      title: snapshot.title,
      description: snapshot.description,
      profile: profileName,
      artifacts: {
        html: "page.html",
        text: "page.txt",
        screenshot: command === "screenshot" || command === "run" ? "screenshot.png" : null,
        report: command === "run" ? "report.md" : null
      },
      counts: {
        links: snapshot.links.length,
        headings: snapshot.headings.length,
        bodyChars: snapshot.text.length
      }
    };
    await writeJson(path.join(resolvedOutDir, "receipt.json"), receipt);
    await fs.writeFile(path.join(resolvedOutDir, "summary.txt"), `${buildSummary(receipt)}\n`);
    await context.close();
    return receipt;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

export async function testTorRoute({
  url = "https://example.com",
  proxy = DEFAULT_PROXY,
  timeoutMs = 15_000,
  browserType = chromium,
  browserPath = null
} = {}) {
  const browserInfo = await inspectBrowser();
  let browser;
  const startedAt = new Date().toISOString();
  try {
    browser = await browserType.launch({
      headless: true,
      ...(browserPath ? { executablePath: browserPath } : browserInfo.executablePath ? { executablePath: browserInfo.executablePath } : {}),
      proxy: { server: proxy }
    });
    const context = await browser.newContext({ viewport: DEFAULT_VIEWPORT });
    const page = await context.newPage();
    page.setDefaultTimeout(timeoutMs);
    await page.goto(url, { waitUntil: "domcontentloaded" });
    const title = await page.title();
    await context.close();
    return {
      ok: true,
      url,
      proxy,
      startedAt,
      finishedAt: new Date().toISOString(),
      title
    };
  } catch (error) {
    return {
      ok: false,
      url,
      proxy,
      startedAt,
      finishedAt: new Date().toISOString(),
      error: formatRuntimeError(error, { useProxy: true, proxy })
    };
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

export async function runDoctor({
  proxy = DEFAULT_PROXY,
  baseDir = "artifacts",
  platform = process.platform,
  commandRunner = runCommand,
  portChecker = isTcpPortOpen
} = {}) {
  const browser = await inspectBrowser();
  const tor = await inspectTorSetup({ proxy, platform, commandRunner, portChecker });
  let writable = { ok: true, value: path.resolve(baseDir), message: "output directory is writable" };
  try {
    writable.value = await verifyWritableDir(baseDir);
  } catch (error) {
    writable = { ok: false, value: path.resolve(baseDir), message: error.message };
  }
  return {
    proxy,
    checks: [
      {
        name: "browser",
        ok: browser.available,
        detail: browser.available ? browser.executablePath : "No local Chrome/Chromium/Brave/Edge executable found"
      },
      {
        name: "tor-binary",
        ok: tor.torBinary,
        detail: tor.torBinary ? "tor binary available" : "tor binary not found"
      },
      {
        name: "tor-socks-port",
        ok: tor.portOpen,
        detail: tor.portOpen ? `${tor.host}:${tor.port} reachable` : `${tor.host}:${tor.port} is not listening`
      },
      {
        name: "output-dir",
        ok: writable.ok,
        detail: writable.ok ? writable.value : writable.message
      }
    ]
  };
}

export async function openPath(targetPath, platform = process.platform, commandRunner = runCommand) {
  const resolved = path.resolve(targetPath);
  if (platform === "darwin") {
    return await commandRunner("open", [resolved]);
  }
  if (platform === "win32") {
    return await commandRunner("cmd", ["/c", "start", "", resolved]);
  }
  return await commandRunner("xdg-open", [resolved]);
}
