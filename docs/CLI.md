# CLI

## `agentor`

Prints a short first-run onboarding flow.

## `agentor doctor`

Runs a quick environment audit:

- browser availability
- tor binary presence
- SOCKS port reachability
- output directory writability

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

## Aliases

```bash
agentor shot <url>
agentor research <url> --prompt "research this page"
```

## `agentor --version`

Prints the package version.

## `agentor setup tor`

Checks whether the `tor` binary exists and whether the SOCKS proxy is reachable.

Examples:

```bash
agentor setup tor
agentor setup tor --install
agentor setup tor --proxy socks5://127.0.0.1:9050 --json
```

Current install targets:

- macOS: `brew install tor`
- Linux: `sudo apt-get install -y tor`
- Windows: `winget install --id TorProject.TorBrowser -e`

## `agentor test tor`

Checks whether a real proxied browser route works right now.

```bash
agentor test tor
agentor test tor --url https://example.com --json
```

## `agentor demo`

Runs a local no-proxy demo page and writes the usual artifacts so users can inspect the full flow immediately.

## `agentor open <run-dir>`

Opens a run directory in the OS file browser.

## `agentor profile ...`

Save and reuse local defaults:

```bash
agentor profile add tor-local --proxy socks5://127.0.0.1:9050
agentor profile list
agentor profile use tor-local
agentor profile remove tor-local
```

## `agentor config show`

Prints the active config file path and saved profiles.

## Flags

- `--out <dir>`: output directory
- `--proxy <url>`: proxy server, default `socks5://127.0.0.1:9050`
- `--no-proxy`: direct browser session
- `--timeout <ms>`: navigation timeout
- `--json`: print receipt JSON to stdout
- `--install`: attempt Tor installation during `setup tor`
- `--profile <name>`: use a saved local profile

If proxy routing fails, the CLI tells you to start Tor, provide `--proxy`, or retry with `--no-proxy`.
