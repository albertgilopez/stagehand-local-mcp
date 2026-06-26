# stagehand-local-mcp

A small, **self-hosted** [MCP](https://modelcontextprotocol.io) server that wraps the
[Stagehand](https://github.com/browserbase/stagehand) library so an MCP client (Claude Code,
Claude Desktop, …) can drive a **local, headed, persistent browser** with natural language.

- **One browser, alive for the whole session** → no open/close per action.
- **Persistent profile** (`userDataDir`) → log in once, the session is reused across restarts.
- **API key read from the environment**, never from the MCP config.
- **You own the code** — it wraps the audited Stagehand library directly, instead of trusting a
  third-party package with control of your authenticated browser + API key.

## Why

The official Browserbase MCP is cloud-only (paid). Community local MCPs exist but hand a
third-party package your authenticated session and model key. This is ~150 lines you can read.

## Tools

| Tool | What |
|---|---|
| `stagehand_navigate` | go to a URL |
| `stagehand_act` | natural-language action (`"click the login button"`). **To type into a field**, use `"type 'X' into the Y field"` → maps to a `fill` |
| `stagehand_extract` | structured/free-text extraction (optional `fields`, optional `screenshot` for vision) |
| `stagehand_observe` | locate elements |
| `stagehand_type` | keyboard typing — **may fail** on some Stagehand builds (no `page.keyboard`); prefer `act` for text |
| `stagehand_screenshot` | returns a PNG of the viewport |
| `stagehand_status` | current URL + title |

## Install

```bash
git clone https://github.com/albertgilopez/stagehand-local-mcp.git
cd stagehand-local-mcp
npm install            # installs deps + Chromium (postinstall)
```

## Configure (Claude Code)

```bash
# API key via env var (recommended):
claude mcp add stagehand-local -s user \
  -e ANTHROPIC_API_KEY=sk-ant-... \
  -- node /abs/path/to/stagehand-local-mcp/mcp-server.mjs
```

Or keep the key out of the config and point to a dotenv-style file:

```bash
claude mcp add stagehand-local -s user \
  -e ENV_FILE=/abs/path/to/.env \
  -- node /abs/path/to/stagehand-local-mcp/mcp-server.mjs
```

⚠️ MCP tools register **at client startup** — restart Claude Code after adding.

## Environment variables

| Var | Default | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | model key (required, unless via `ENV_FILE`) |
| `ENV_FILE` | — | path to a `.env` containing `ANTHROPIC_API_KEY=` |
| `STAGEHAND_MODEL` | `anthropic/claude-sonnet-4-6` | model for act/extract/observe |
| `STAGEHAND_HEADLESS` | `false` | run headless |
| `STAGEHAND_USER_DATA_DIR` | `./.auth/chrome-profile` | persistent browser profile |

## Notes / gotchas (Stagehand v3.x)

- The page handle is `stagehand.context.pages()[0]` (`stagehand.page` may be `undefined`); it does
  **not** expose `getByText`, `keyboard`, or `page.on("response")`.
- Only `extract` supports `{ screenshot: true }` (vision); `act`/`observe` always use the a11y tree.
- Writing into fields: use `act("type 'X' into the Y field")` (Stagehand maps it to `fill`).

## License

MIT
