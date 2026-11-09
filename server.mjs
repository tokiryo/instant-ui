#!/usr/bin/env node
// instant-ui: an MCP server (stdio, no dependencies) that lets an agent show a small interactive page
// it just wrote and get back what the person entered.
//   show_ui         (always)  opens the page in a browser window and returns the submitted values.
//   show_ui_inline  (--inline) draws the page inside the chat of an MCP Apps host (e.g. T3 Code);
//                              the values come back as the person's next chat message.
// Options: --inline=auto|on|off (auto: where the host draws MCP Apps), --browser=auto|chrome|default.
import http from "node:http";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

const VERSION = "0.1.0";
// --name=value (the first allowed value is the default), or a bare --name meaning "on".
const option = (name, allowed) => {
  const a = process.argv.find((x) => x === `--${name}` || x.startsWith(`--${name}=`));
  const v = a ? a.slice(name.length + 3) || "on" : allowed[0];
  if (allowed.includes(v)) return v;
  process.stderr.write(`instant-ui: --${name} must be ${allowed.join(", ")} (got ${v})\n`);
  process.exit(2);
};
const INLINE_MODE = option("inline", ["auto", "on", "off"]);
// auto: the client declares MCP Apps support at initialize; Claude Code in T3 Code draws them without declaring it.
let inline = INLINE_MODE === "on" || (INLINE_MODE === "auto" && process.env.CLAUDE_CODE_ENTRYPOINT === "t3-code");
// auto: a Chrome app window, the default browser if Chrome cannot start. chrome: Chrome only. default: the default browser.
const BROWSER = option("browser", ["auto", "chrome", "default"]);
const APP_URI = "ui://instant-ui/app";
const APP_MIME = "text/html;profile=mcp-app";
const DEFAULT_WAIT = Number(process.env.INSTANT_UI_TIMEOUT ?? 600);

const htmlInput = {
  title: { type: "string", description: "Short title shown on the page and returned with the values." },
  html: {
    type: "string",
    description:
      "A self-contained HTML page or fragment (inline <style>/<script>, no network). " +
      "Every <form> is sent when submitted; scripts can also call submit(anyJsonValue).",
  },
};

const showUi = {
  name: "show_ui",
  description:
    "Open an interactive page in the person's browser and wait until they submit it. " +
    "Returns the submitted values as JSON, or a timeout notice.",
  inputSchema: {
    type: "object",
    properties: { ...htmlInput, timeout_seconds: { type: "number", description: `How long to wait (default ${DEFAULT_WAIT}).` } },
    required: ["title", "html"],
  },
};
const showUiInline = {
  name: "show_ui_inline",
  description:
    "Draw an interactive page inside the chat (MCP Apps hosts only). Returns at once; " +
    "the submitted values arrive as the person's next message, starting with [instant-ui].",
  inputSchema: { type: "object", properties: htmlInput, required: ["title", "html"] },
  _meta: { ui: { resourceUri: APP_URI } },
};

// Injected into every page: submit() plus automatic <form> handling.
const helper = (send) => `<script>
(() => {
  let sent = false;
  window.submit = async (data) => {
    if (sent) return; sent = true;
    try { await (${send})(data); document.body.insertAdjacentHTML("beforeend", '<p data-instant-ui-done style="opacity:.7">Sent.</p>'); }
    catch (e) { sent = false; alert("Could not send: " + e.message); }
  };
  document.addEventListener("submit", (e) => {
    e.preventDefault();
    const out = {};
    for (const [k, v] of new FormData(e.target, e.submitter)) out[k] = k in out ? [].concat(out[k], v) : v;
    window.submit(out);
  }, true);
})();
</script>`;

function withHelper(html, script) {
  return /<\/body>/i.test(html) ? html.replace(/<\/body>/i, `${script}</body>`) : html + script;
}

// `open` and `start` exit at once, non-zero when the browser is missing; on Linux the browser itself runs.
const launch = ([cmd, args], fail = () => {}) =>
  spawn(cmd, args, { stdio: "ignore", detached: true })
    .on("error", fail)
    .on("exit", (code) => process.platform !== "linux" && code && fail())
    .unref();

// The default browser, or a Chrome app window (no tabs, no address bar).
function openBrowser(url, giveUp) {
  const os = process.platform;
  const app = [`--app=${url}`, "--window-size=560,720"];
  const [tab, chrome] =
    os === "darwin" ? [["open", [url]], ["open", ["-na", "Google Chrome", "--args", ...app]]] :
    os === "win32" ? [["cmd", ["/c", "start", "", url]], ["cmd", ["/c", "start", "", "chrome", ...app]]] :
    [["xdg-open", [url]], ["google-chrome", app]];
  if (BROWSER === "default") return launch(tab);
  launch(chrome, BROWSER === "chrome" ? () => giveUp("could not start Chrome") : () => launch(tab));
}

// One page, one local server: 127.0.0.1 only, a random path token, closed after the first submit.
function showInBrowser({ title, html, timeout_seconds }) {
  const token = randomBytes(16).toString("hex");
  const wait = (timeout_seconds ?? DEFAULT_WAIT) * 1000;
  const send = `(d) => fetch(location.pathname + "/submit", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(d ?? null) }).then(r => { if (!r.ok) throw new Error(r.status); setTimeout(() => window.close(), 800); })`;
  const page = withHelper(/<html/i.test(html) ? html : `<!doctype html><meta charset="utf-8"><title>${title.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`)}</title><body>${html}</body>`, helper(send));
  return new Promise((resolve) => {
    let timer;
    const server = http.createServer((req, res) => {
      if (req.method === "GET" && req.url === `/${token}`) {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
        return res.end(page);
      }
      if (req.method === "POST" && req.url === `/${token}/submit`) {
        let body = "";
        req.on("data", (c) => { body += c; if (body.length > 1e6) req.destroy(); });
        return req.on("end", () => {
          let values;
          try { values = JSON.parse(body); } catch { res.writeHead(400); return res.end(); }
          res.writeHead(204).end();
          finish({ submitted: true, title, values });
        });
      }
      res.writeHead(404).end();
    });
    const finish = (result) => { clearTimeout(timer); server.close(); server.closeAllConnections?.(); resolve(result); };
    server.listen(0, "127.0.0.1", () => {
      const url = `http://127.0.0.1:${server.address().port}/${token}`;
      process.env.INSTANT_UI_NO_OPEN ? process.stderr.write(`instant-ui: ${url}\n`) : openBrowser(url, (reason) => finish({ submitted: false, title, reason }));
      timer = setTimeout(() => finish({ submitted: false, title, reason: `no submit within ${wait / 1000}s` }), wait);
    });
  });
}

// The MCP Apps shell: takes the page from the tool input and sends values back with ui/message.
const appShell = `<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div><script>
(() => {
  let id = 0, title = "";
  const pending = new Map();
  const post = (m) => window.parent.postMessage({ jsonrpc: "2.0", ...m }, "*");
  const request = (method, params) => new Promise((ok, fail) => { const i = ++id; pending.set(i, { ok, fail }); post({ id: i, method, params }); });
  const resize = () => post({ method: "ui/notifications/size-changed", params: { height: Math.ceil(document.documentElement.getBoundingClientRect().height) } });
  window.__instantUiSend = (data) => request("ui/message", { role: "user", content: [{ type: "text", text: "[instant-ui] " + title + "\\n" + JSON.stringify(data, null, 2) }] });
  function render(args) {
    title = args.title || "";
    const doc = new DOMParser().parseFromString(args.html || "", "text/html");
    for (const n of doc.head.querySelectorAll("style,link,meta[name=viewport]")) document.head.appendChild(n);
    const root = document.getElementById("root");
    root.replaceChildren(...doc.body.childNodes);
    for (const old of root.querySelectorAll("script")) {
      const s = document.createElement("script");
      for (const a of old.attributes) s.setAttribute(a.name, a.value);
      s.textContent = old.textContent;
      old.replaceWith(s);
    }
    resize();
  }
  window.addEventListener("message", (e) => {
    if (e.source !== window.parent) return;
    const m = e.data || {};
    if (m.id != null && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.fail(new Error(m.error.message)) : p.ok(m.result); }
    else if (m.method === "ui/notifications/tool-input") render(m.params.arguments || {});
    else if (m.method === "ui/resource-teardown") post({ id: m.id, result: {} });
  });
  new ResizeObserver(resize).observe(document.documentElement);
  request("ui/initialize", { protocolVersion: "2026-01-26", appInfo: { name: "instant-ui", version: "${VERSION}" }, appCapabilities: {} })
    .then(() => post({ method: "ui/notifications/initialized", params: {} }));
})();
</script>${helper("(d) => window.__instantUiSend(d)")}</body></html>`;

// --- MCP over stdio (newline-delimited JSON-RPC) ---
const write = (m) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...m }) + "\n");
const text = (t, isError) => ({ content: [{ type: "text", text: t }], ...(isError ? { isError: true } : {}) });

async function handle(method, params) {
  switch (method) {
    case "initialize":
      if (INLINE_MODE === "auto" && params?.capabilities?.extensions?.["io.modelcontextprotocol/ui"]) inline = true;
      return {
        protocolVersion: params?.protocolVersion ?? "2025-06-18",
        capabilities: { tools: {}, ...(inline ? { resources: {} } : {}) },
        serverInfo: { name: "instant-ui", version: VERSION },
      };
    case "ping": return {};
    case "tools/list": return { tools: inline ? [showUi, showUiInline] : [showUi] };
    case "resources/list":
      return { resources: inline ? [{ uri: APP_URI, name: "instant-ui page", mimeType: APP_MIME }] : [] };
    case "resources/read":
      if (!inline || params?.uri !== APP_URI) throw { code: -32602, message: `unknown resource ${params?.uri}` };
      return { contents: [{ uri: APP_URI, mimeType: APP_MIME, text: appShell }] };
    case "tools/call": {
      const { name, arguments: a = {} } = params ?? {};
      if (typeof a.title !== "string" || typeof a.html !== "string") return text("title and html are required strings", true);
      if (name === "show_ui") return text(JSON.stringify(await showInBrowser(a)));
      if (name === "show_ui_inline" && inline) return text("Shown in the chat. The values arrive as the person's next message, starting with [instant-ui].");
      return text(`unknown tool ${name}`, true);
    }
    default: throw { code: -32601, message: `method not found: ${method}` };
  }
}

createInterface({ input: process.stdin }).on("line", async (line) => {
  let m;
  try { m = JSON.parse(line); } catch { return write({ id: null, error: { code: -32700, message: "parse error" } }); }
  if (m.id === undefined) return; // notifications need no answer
  try { write({ id: m.id, result: await handle(m.method, m.params) }); }
  catch (e) { write({ id: m.id, error: { code: e.code ?? -32603, message: e.message ?? String(e) } }); }
});
