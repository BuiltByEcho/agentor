# CLI

## `agentor fetch <url>`

Opens the page, waits for DOM content, stores HTML/text, and writes `receipt.json`.

Example:

```bash
agentor fetch https://example.com --out ./artifacts/example --json
```

## `agentor screenshot <url>`

Does everything `fetch` does, plus a viewport screenshot.

Example:

```bash
agentor screenshot https://example.com --out ./artifacts/example-shot
```

## `agentor run <url>`

Opens the page, captures artifacts, then creates a compact markdown report from the title, meta description, headings, links, and body text.

Example:

```bash
agentor run https://example.com --prompt "research this page"
```

## `agentor --version`

Prints the package version.

## Flags

- `--out <dir>`: output directory
- `--proxy <url>`: proxy server, default `socks5://127.0.0.1:9050`
- `--no-proxy`: direct browser session
- `--timeout <ms>`: navigation timeout
- `--json`: print receipt JSON to stdout

If proxy routing fails, the CLI tells you to start Tor, provide `--proxy`, or retry with `--no-proxy`.
