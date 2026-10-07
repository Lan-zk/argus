#!/usr/bin/env node
// 从无头浏览器上下文直接 fetch mock，验证 CORS/连通性
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const profile = mkdtempSync(join(tmpdir(), "argus-fp-"));
const chrome = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run", "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
process.on("exit", () => { try { chrome.kill(); } catch {} try { rmSync(profile, { recursive: true, force: true }); } catch {} });
const wsUrl = await new Promise((ok, no) => {
  let b = "";
  const t = setTimeout(() => no(new Error("chrome 没启动")), 15000);
  chrome.stderr.on("data", (d) => { b += d; const m = b.match(/DevTools listening on (ws:\/\/\S+)/); if (m) { clearTimeout(t); ok(m[1]); } });
});
const ws = new WebSocket(wsUrl);
await new Promise((ok) => { ws.onopen = ok; });
let seq = 0; const pending = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.no(new Error(m.error.message)) : p.ok(m.result); } };
const send = (m, p = {}, sid) => new Promise((ok, no) => { const id = ++seq; pending.set(id, { ok, no }); ws.send(JSON.stringify({ id, method: m, params: p, ...(sid ? { sessionId: sid } : {}) })); });
const { targetId } = await send("Target.createTarget", { url: "http://localhost:1420" });
const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
await send("Page.enable", {}, sessionId).catch(() => {});
await new Promise((r) => setTimeout(r, 1500));
const js = async (code) => {
  const r = await send("Runtime.evaluate", { expression: code, awaitPromise: true, returnByValue: true }, sessionId);
  if (r.exceptionDetails) return "EXC: " + (r.exceptionDetails.exception?.description || r.exceptionDetails.text).split("\n")[0];
  return r.result.value;
};
console.log("GET /test  →", await js(`fetch('http://127.0.0.1:8932/test').then(r => 'HTTP ' + r.status + ' acao=' + r.headers.get('access-control-allow-origin')).catch(e => 'ERR: ' + e.message)`));
console.log("POST chat  →", await js(`fetch('http://127.0.0.1:8932/v1/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer sk-mock' }, body: JSON.stringify({ model: 'mock-pro', messages: [{ role: 'user', content: 'hi' }] }) }).then(async r => 'HTTP ' + r.status + ' len=' + (await r.text()).length).catch(e => 'ERR: ' + e.message)`));
console.log("GET models →", await js(`fetch('http://127.0.0.1:8932/v1/models', { headers: { authorization: 'Bearer sk-mock' } }).then(r => 'HTTP ' + r.status).catch(e => 'ERR: ' + e.message)`));
chrome.kill();
process.exit(0);
