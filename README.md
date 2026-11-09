# instant-ui

[日本語](README.ja.md)

Let a CLI agent show you a small interactive page it writes on the spot, and get back what you enter.

- **Default:** the page opens in your browser; the agent's tool call waits until you submit and gets the values.
  Works with any agent that speaks MCP (Claude Code, Codex, Gemini CLI, ...).
- **Inside the chat:** for hosts that render MCP Apps, the page appears inside the chat
  and your values come back as your next message. See [T3 Code](#t3-code).

One file, Node 18+, no dependencies.

## Install

Clone this repository, then register the server with your agent and (if it supports skills) add the skill.

### Claude Code
```sh
claude mcp add --scope user instant-ui -- node /path/to/instant-ui/server.mjs
ln -s /path/to/instant-ui/skills/instant-ui ~/.claude/skills/instant-ui
```
Start a new session afterwards; MCP servers load at session start.

### Codex
`~/.codex/config.toml`:
```toml
[mcp_servers.instant-ui]
command = "node"
args = ["/path/to/instant-ui/server.mjs"]
tool_timeout_sec = 600   # the call waits for you; the default timeout is too short
```

### Gemini CLI
`~/.gemini/settings.json`:
```json
{ "mcpServers": { "instant-ui": { "command": "node", "args": ["/path/to/instant-ui/server.mjs"], "timeout": 600000 } } }
```

Agents without skills still see the tool descriptions; `skills/instant-ui/SKILL.md` adds guidance on writing good pages.

## Tools
| Tool | When | Returns |
|---|---|---|
| `show_ui(title, html, timeout_seconds?)` | always | `{"submitted":true,"title","values"}` after you submit, or `{"submitted":false,"reason"}` |
| `show_ui_inline(title, html)` | see `--inline` | at once; values arrive as your next message, `[instant-ui] <title>` + JSON |

In the page, every `<form>` is sent on submit (`{name: value}`, repeated names become arrays), and scripts can call `submit(anyJsonValue)`.

## Settings
- `INSTANT_UI_TIMEOUT` - seconds `show_ui` waits by default (600).
- `INSTANT_UI_NO_OPEN=1` - do not open a browser; print the URL to stderr instead.

## Options
Add them after `server.mjs` in the command you register.

| Option | Values | Default |
|---|---|---|
| `--inline=` | `auto`: offer `show_ui_inline` only where the host draws MCP Apps (see [T3 Code](#t3-code)). `on`: always. `off`: never. A bare `--inline` means `on`. | `auto` |
| `--browser=` | `auto`: a Chrome app window, or the default browser if Chrome cannot start. `chrome`: a Chrome app window only; if Chrome cannot start, `show_ui` returns `{"submitted":false,"reason":"could not start Chrome"}`. `default`: a tab of the default browser. | `auto` |

A Chrome app window has no tabs or address bar and closes itself after you submit.

## Safety
- The browser page is served on `127.0.0.1` only, under a random one-time path, and the server closes after the first submit or the timeout.
- Whatever you submit enters the agent's conversation. Do not type secrets into these pages.

## Test
```sh
node test.mjs
```

## T3 Code
T3 Code runs several agent harnesses (Claude Code, Codex, ...) and draws MCP Apps in its chat, so there the page
can appear inside the chat instead of a browser window.
- Register the server with the harness you use in T3 Code, as above; nothing extra is needed.
- With `--inline=auto` (the default), `show_ui_inline` is offered when the harness declares MCP Apps support
  (the `io.modelcontextprotocol/ui` extension) when it connects, and for Claude Code in T3 Code
  (`CLAUDE_CODE_ENTRYPOINT=t3-code`), which draws them without declaring it.
  If a harness draws pages but `show_ui_inline` is missing, use `--inline=on`.
- The page inherits T3 Code's theme: its background, text colors, and font.
- `show_ui_inline` returns at once; your values arrive as your next chat message, `[instant-ui] <title>` + JSON.
- `show_ui` still works there and opens a browser window. Use `--inline=off` to offer only that.
