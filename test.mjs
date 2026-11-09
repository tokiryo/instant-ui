// Self-check: drive the server over stdio like an agent, submit the page like a browser. Run: node test.mjs
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import assert from "node:assert/strict";

function start(...args) {
  const p = spawn(process.execPath, [new URL("server.mjs", import.meta.url).pathname, ...args], {
    env: { ...process.env, INSTANT_UI_NO_OPEN: "1" },
  });
  const waiting = new Map();
  let id = 0, url;
  const urls = [];
  createInterface({ input: p.stdout }).on("line", (l) => { const m = JSON.parse(l); waiting.get(m.id)?.(m); });
  createInterface({ input: p.stderr }).on("line", (l) => { const u = l.match(/instant-ui: (\S+)/)?.[1]; if (u) urls.push(u); });
  const call = (method, params) => new Promise((ok) => { const i = ++id; waiting.set(i, ok); p.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: i, method, params }) + "\n"); });
  const nextUrl = async () => { while (!urls.length) await new Promise((r) => setTimeout(r, 20)); return urls.shift(); };
  return { call, nextUrl, stop: () => p.kill() };
}

const s = start();
assert.equal((await s.call("initialize", { protocolVersion: "2025-06-18" })).result.serverInfo.name, "instant-ui");
assert.deepEqual((await s.call("tools/list")).result.tools.map((t) => t.name), ["show_ui"]);

// Submit a form: values come back as the tool result.
const pending = s.call("tools/call", { name: "show_ui", arguments: { title: "Pick", html: "<form><input name=a></form>" } });
const url = await s.nextUrl();
const page = await (await fetch(url)).text();
assert.match(page, /window\.submit/);
assert.equal((await fetch(url.replace(/\/[^/]+$/, "/wrongtoken"))).status, 404);
assert.equal((await fetch(url + "/submit", { method: "POST", body: JSON.stringify({ a: "1", b: ["x", "y"] }) })).status, 204);
const res = JSON.parse((await pending).result.content[0].text);
assert.deepEqual(res, { submitted: true, title: "Pick", values: { a: "1", b: ["x", "y"] } });
await assert.rejects(fetch(url)); // the page's server is gone after the submit

// Timeout returns a notice instead of hanging.
const late = await s.call("tools/call", { name: "show_ui", arguments: { title: "T", html: "<p>x", timeout_seconds: 0.2 } });
await s.nextUrl();
assert.equal(JSON.parse(late.result.content[0].text).submitted, false);
assert.equal((await s.call("tools/call", { name: "show_ui_inline", arguments: { title: "x", html: "x" } })).result.isError, true);
s.stop();

// --inline adds the MCP Apps tool and its page.
const i = start("--inline");
await i.call("initialize", {});
const inline = (await i.call("tools/list")).result.tools.find((t) => t.name === "show_ui_inline");
assert.equal(inline._meta.ui.resourceUri, "ui://instant-ui/app");
const app = (await i.call("resources/read", { uri: "ui://instant-ui/app" })).result.contents[0];
assert.equal(app.mimeType, "text/html;profile=mcp-app");
assert.match(app.text, /ui\/message/);
assert.match((await i.call("tools/call", { name: "show_ui_inline", arguments: { title: "x", html: "x" } })).result.content[0].text, /next message/);
i.stop();
console.log("ok");
