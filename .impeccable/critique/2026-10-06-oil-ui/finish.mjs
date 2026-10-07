#!/usr/bin/env node
// 收尾会话：200% 细节 ×2 + 宽窗口（补 drive.mjs 未完成的 16/17/18）
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const URL_APP = "http://localhost:1420";
const OUT = new URL(".", import.meta.url).pathname + "shots";
mkdirSync(OUT, { recursive: true });
const DOC = `远程办公正在重塑城市的生活节奏。过去三年里，越来越多的知识工作者选择离开一线城市，搬到成本更低的小城镇生活。有人据此断言，办公室的时代已经终结，城市将不可避免地走向衰落。
这种结论下得为时过早。远程办公的确改变了部分行业的用工方式，但协同密集型的工作仍然高度依赖面对面的交流。研究显示，视频会议无法完全替代白板前的即兴讨论，也难以复现走廊里的偶然碰撞。
更重要的是，人口流动的数据并不支持单一方向的判断。部分年轻人回流大城市的同时，也有另一批人在小城扎根创业。城市与小镇的兴衰是多重因素交织的结果，把它归因于办公形态的变化，是一种以偏概全的因果推断。`;

const profile = mkdtempSync(join(tmpdir(), "argus-fin-"));
const chrome = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run", "--hide-scrollbars", "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
process.on("exit", () => { try { chrome.kill(); } catch {} try { rmSync(profile, { recursive: true, force: true }); } catch {} });
const wsUrl = await new Promise((ok, no) => { let b = ""; const t = setTimeout(() => no(new Error("no chrome")), 15000); chrome.stderr.on("data", (d) => { b += d; const m = b.match(/DevTools listening on (ws:\/\/\S+)/); if (m) { clearTimeout(t); ok(m[1]); } }); });
const ws = new WebSocket(wsUrl);
await new Promise((ok) => { ws.onopen = ok; });
let seq = 0; const pending = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.no(new Error(m.error.message)) : p.ok(m.result); } };
const send = (m, p = {}, sid) => new Promise((ok, no) => { const id = ++seq; pending.set(id, { ok, no }); ws.send(JSON.stringify({ id, method: m, params: p, ...(sid ? { sessionId: sid } : {}) })); });
const { targetId } = await send("Target.createTarget", { url: "about:blank" });
const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
const cdp = (m, p) => send(m, p, sessionId);
await cdp("Page.enable");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const js = async (code) => { const r = await cdp("Runtime.evaluate", { expression: code, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception?.description || "").split("\n")[0]); return r.result.value; };
const viewport = (w, h, s = 1) => cdp("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: s, mobile: false });
const shot = async (n) => { const { data } = await cdp("Page.captureScreenshot", { format: "png" }); writeFileSync(`${OUT}/${n}.png`, Buffer.from(data, "base64")); console.log("📸", n); };

const PRIM = `
const dc = (sel) => { const el = document.querySelector(sel); if (!el) throw new Error("找不到：" + sel); el.click(); };
const sv = (sel, v) => { const el = document.querySelector(sel); el.focus(); el.value = v; el.dispatchEvent(new Event("input", { bubbles: true })); };
const waitSel = (sel, ms = 15000) => { const t0 = Date.now(); return new Promise((ok, no) => { const tick = () => { if (document.querySelector(sel)) return ok(true); if (Date.now() - t0 > ms) return no(new Error("超时：" + sel)); setTimeout(tick, 120); }; tick(); }); };
const waitGone = (sel, ms = 15000) => { const t0 = Date.now(); return new Promise((ok, no) => { const tick = () => { if (!document.querySelector(sel)) return ok(true); if (Date.now() - t0 > ms) return no(new Error("等消失超时：" + sel)); setTimeout(tick, 120); }; tick(); }); };
const text = (sel) => (document.querySelector(sel)?.textContent || "").trim();
`;
const prim = (code) => js(`(async () => { ${PRIM} ${code} })()`);
const goSet = `dc('.ws-statusbar .ws-actions button.mini:not(.primary)'); await waitSel('[data-appearance-option=light]')`;
const backWs = `dc('.psb-row'); await waitSel('.docpane'); await new Promise(r=>setTimeout(r,700))`;

try {
  await cdp("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });
  viewport(1240, 800);
  await cdp("Page.navigate", { url: URL_APP });
  await sleep(1500);
  await prim(`waitSel('.ob-layer'); dc('.ob-alt .ob-card'); await waitSel('.ob-fields input')`);
  await prim(`sv('[data-test=ob-custom-baseurl]', 'http://127.0.0.1:8932/v1'); sv('.ob-fields input[type=password]', 'sk-mock'); sv('[data-test=ob-custom-model]', 'mock-pro'); await new Promise(r=>setTimeout(r,250)); dc('[data-test=ob-save]'); await waitGone('.ob-layer')`);
  await prim(`waitSel('.doc-input'); sv('.doc-input', ${JSON.stringify(DOC)}); await new Promise(r=>setTimeout(r,300)); dc('.new-actions .cta')`);
  await prim(`(async()=>{const t0=Date.now();while(Date.now()-t0<30000){const b=text('.ws-statusbar .badge');if(b.includes('完成'))return true;await new Promise(r=>setTimeout(r,250));}throw new Error('审阅未完成：'+text('.ws-statusbar .badge'));})()`);
  await prim(`${backWs}`);

  viewport(1240, 800, 2);
  await sleep(400);
  await shot("16-zoom200-ws-swiss-light");
  await prim(`${goSet}; dc('[data-theme-option=apple]'); await new Promise(r=>setTimeout(r,300)); dc('[data-appearance-option=dark]'); await new Promise(r=>setTimeout(r,400)); ${backWs}`);
  await shot("17-zoom200-ws-apple-dark");
  viewport(1600, 1000, 1);
  await prim(`${goSet}; dc('[data-theme-option=swiss]'); await new Promise(r=>setTimeout(r,300)); dc('[data-appearance-option=light]'); await new Promise(r=>setTimeout(r,400)); ${backWs}`);
  await sleep(400);
  await shot("18-ws-wide-swiss-light");
} catch (e) {
  console.log("❌ 收尾会话失败：", e.message);
}
chrome.kill();
process.exit(0);
