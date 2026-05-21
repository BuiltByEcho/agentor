import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright-core";

export const VERSION = "0.1.0";
const DEFAULT_PROXY = "socks5://127.0.0.1:9050";
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_VIEWPORT = { width: 1440, height: 900 };
const LOCAL_BROWSER_CANDIDATES = [
  process.env.AGENTOR_BROWSER_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"
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

export function parseArgs(argv) {
  const args = [...argv];
  const result = {
    flags: {}
  };
  while (args.length > 0) {
    const token = args.shift();
    if (!token.startsWith("--")) {
      result._ = result._ || [];
      result._.push(token);
      continue;
    }
    if (token === "--json" || token === "--no-proxy") {
      result.flags[token.slice(2)] = true;
      continue;
    }
    const key = token.slice(2);
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
    `# agenTOR Report`,
    ``,
    ...topFacts,
    ``,
    `## Headings`,
    ...(topHeadings.length > 0 ? topHeadings : ["- None found"]),
    ``,
    `## Links`,
    ...(topLinks.length > 0 ? topLinks : ["- None found"])
  ].join("\n");
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function resolveBrowserLaunchOptions() {
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
    const headings = Array.from(document.querySelectorAll("h1,h2,h3")).map((heading) =>
      (heading.textContent || "").trim().replace(/\s+/g, " ")
    ).filter(Boolean);
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

export async function runSession({
  command,
  url,
  outDir,
  proxy = DEFAULT_PROXY,
  useProxy = true,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  prompt,
  browserType = chromium
}) {
  const resolvedOutDir = outDir || makeOutputDir(url);
  await ensureDir(resolvedOutDir);
  const launchOptions = await resolveBrowserLaunchOptions();
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
    await context.close();
    return receipt;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}
