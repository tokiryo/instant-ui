# instant-ui

Let a CLI agent show you a small interactive page it writes on the spot, and get back what you enter.

- **Default:** the page opens in your browser; the agent's tool call waits until you submit and gets the values.
  Works with any agent that speaks MCP (Claude Code, Codex, Gemini CLI, ...).
- **Option `--inline`:** for hosts that render MCP Apps (for example T3 Code), the page appears inside the chat
  and your values come back as your next message.

One file, Node 18+, no dependencies.

## Install

Clone this repository, then register the server with your agent and (if it supports skills) add the skill.

### Claude Code
```sh
claude mcp add --scope user instant-ui -- node /path/to/instant-ui/server.mjs
ln -s /path/to/instant-ui/skills/instant-ui ~/.claude/skills/instant-ui
```
To show pages in the chat in T3 Code, add `--inline` after `server.mjs`. It is safe in the plain terminal
too: the skill uses the inline tool only when the host draws MCP Apps.
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
| `show_ui_inline(title, html)` | with `--inline` | at once; values arrive as your next message, `[instant-ui] <title>` + JSON |

In the page, every `<form>` is sent on submit (`{name: value}`, repeated names become arrays), and scripts can call `submit(anyJsonValue)`.

## Settings
- `INSTANT_UI_TIMEOUT` - seconds `show_ui` waits by default (600).
- `INSTANT_UI_NO_OPEN=1` - do not open a browser; print the URL to stderr instead.

## Safety
- The browser page is served on `127.0.0.1` only, under a random one-time path, and the server closes after the first submit or the timeout.
- Whatever you submit enters the agent's conversation. Do not type secrets into these pages.

## Test
```sh
node test.mjs
```
