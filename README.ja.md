# instant-ui

CLIエージェントがその場で生成した小さなインタラクティブページを表示し、ユーザーが入力した内容を受け取れるようにします。

- **デフォルト**: ページはブラウザで開きます。エージェントのツール呼び出しはユーザーが送信するまで待機し、入力値を取得します。MCPに対応したあらゆるエージェント（Claude Code、Codex、Gemini CLIなど）で動作します。
- **チャット内表示**: MCP Appsのレンダリングに対応したホストでは、チャット内にページが表示され、送信した値は次のメッセージとして返ってきます（T3 Codeなど）。
- 単一ファイル構成、Node 18以上、外部依存パッケージなし。

---

## インストール (Install)

本リポジトリをクローンし、お使いのエージェントにサーバーを登録します（エージェントがSkillsに対応している場合はSkillも追加してください）。

### Claude Code

```bash
claude mcp add --scope user instant-ui -- node /path/to/instant-ui/server.mjs
ln -s /path/to/instant-ui/skills/instant-ui ~/.claude/skills/instant-ui
```

設定後に新しいセッションを開始してください（MCPサーバーはセッション開始時に読み込まれます）。

### Codex

`~/.codex/config.toml`:

```toml
[mcp_servers.instant-ui]
command = "node"
args = ["/path/to/instant-ui/server.mjs"]
tool_timeout_sec = 600   # ユーザー入力を待つため、デフォルトのタイムアウトでは短すぎます
```

### Gemini CLI

`~/.gemini/settings.json`:

```json
{
  "mcpServers": {
    "instant-ui": {
      "command": "node",
      "args": ["/path/to/instant-ui/server.mjs"],
      "timeout": 600000
    }
  }
}
```

Skillsに対応していないエージェントでもツールの説明文は認識されます。`skills/instant-ui/SKILL.md` には、使いやすいページを作成するためのガイダンスが含まれています。

---

## ツール (Tools)

| ツール | 利用タイミング | 戻り値 |
| --- | --- | --- |
| `show_ui(title, html, timeout_seconds?)` | 常時 | 送信後に `{"submitted":true,"title","values"}`、または `{"submitted":false,"reason"}` |
| `show_ui_inline(title, html)` | `--inline` を参照 | 即座に返却。入力値は次のメッセージ `[instant-ui] <title> + JSON` として届く |

ページ内では、すべての `<form>` が送信時に送信されます（`{name: value}` 形式。重複する name は配列化されます）。また、スクリプトから `submit(anyJsonValue)` を直接呼び出すことも可能です。

---

## 環境変数 (Settings)

- `INSTANT_UI_TIMEOUT` - `show_ui` がデフォルトで待機する秒数（初期値: `600`）。
- `INSTANT_UI_NO_OPEN=1` - ブラウザを開かず、代わりにURLを標準エラー出力（stderr）に出力します。

---

## 起動オプション (Options)

登録するコマンド内で `server.mjs` の後に追加します。

| オプション | 設定値 | デフォルト |
| --- | --- | --- |
| `--inline=` | `auto`: ホストがMCP Appsを描画可能な場合にのみ `show_ui_inline` を提供（T3 Codeなど）。 `on`: 常に提供。 `off`: 提供しない。 ※単に `--inline` と指定した場合は `on` 扱いになります。 | `auto` |
| `--browser=` | `auto`: Chromeアプリウィンドウ、またはChromeが起動できない場合はデフォルトブラウザ。 `chrome`: Chromeアプリウィンドウのみ。Chromeが起動できない場合、`show_ui` は `{"submitted":false,"reason":"could not start Chrome"}` を返します。 `default`: デフォルトブラウザのタブ。 | `auto` |

> Chromeアプリウィンドウにはタブやアドレスバーがなく、送信後に自動的に閉じます。

---

## セキュリティ (Safety)

- ブラウザページは `127.0.0.1` のみで配信され、ランダムな使い捨てパスを使用します。サーバーは初回の送信完了時、またはタイムアウト時に自動終了します。
- 送信した内容はすべてエージェントの会話コンテキストに入力されます。パスワードやシークレットなどの機密情報はこれらのページに入力しないでください。

---

## テスト (Test)

```bash
node test.mjs
```

---

## T3 Code での利用

T3 Codeは複数のエージェントハーネス（Claude Code、Codexなど）を実行でき、チャット内でMCP Appsを描画できるため、ブラウザウィンドウを開く代わりにチャット内に直接ページを表示できます。

- 上記の手順に従い、T3 Codeで使用するハーネスにサーバーを登録してください。追加の特別設定は不要です。
- `--inline=auto`（デフォルト）の場合、接続時にハーネスがMCP Appsのサポート（`io.modelcontextprotocol/ui` 拡張）を宣言している場合、およびT3 Code上のClaude Code（`CLAUDE_CODE_ENTRYPOINT=t3-code`：宣言なしで描画可能）に対して `show_ui_inline` が提供されます。ハーネスが描画に対応しているにもかかわらず `show_ui_inline` が表示されない場合は、`--inline=on` を指定してください。
- `show_ui_inline` は即座に返り、入力値はチャットの次のメッセージ（`[instant-ui] <title> + JSON`）として届きます。
- T3 Code内でも `show_ui` は引き続き動作し、ブラウザウィンドウを開きます。ブラウザ表示のみに限定したい場合は `--inline=off` を使用してください。
