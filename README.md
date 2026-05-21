# agenTOR

`agenTOR` gives agents disposable browser sessions with receipts. It routes Chrome through Tor-compatible SOCKS proxies, captures HTML and screenshots, and writes a local artifact trail instead of hand-waving what happened.

## Commands

```bash
agentor fetch <url>
agentor screenshot <url>
agentor run <url> --prompt "research this page"
agentor --version
```

Common flags:

```bash
--out <dir>                 Output directory (default: ./artifacts/<timestamp>-<slug>)
--proxy <url>               Proxy server, default: socks5://127.0.0.1:9050
--no-proxy                  Disable proxy usage
--timeout <ms>              Page timeout, default: 30000
--json                      Print receipt JSON
```

## What it writes

- `receipt.json` - structured metadata for the run
- `page.html` - captured DOM HTML
- `page.txt` - text extraction
- `screenshot.png` - when using `screenshot` or `run`
- `report.md` - heuristic research output for `run`

## Install

```bash
npm install -g @builtbyecho/agentor
```

Or one-shot:

```bash
npx @builtbyecho/agentor fetch https://example.com --json
```

## Tor notes

Default proxy is `socks5://127.0.0.1:9050`. If Tor is not running, pass `--no-proxy` for direct browsing or provide another SOCKS/HTTP proxy with `--proxy`.

If the default proxy is unavailable, `agentor` now fails with an actionable message instead of surfacing the raw browser error.

This is privacy framing and route control, not a promise of anonymity. DNS leaks, login state, downloaded artifacts, and upstream fingerprinting still matter.

## Verification

```bash
npm test
node --check src/cli.js
node --check src/index.js
npm pack --json --dry-run
npm publish --dry-run --access public
```
