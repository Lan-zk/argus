#!/usr/bin/env node
// Argus UI 评审取证驱动：shoot.mjs 的合成鼠标点击在本应用上不可靠（div/span @click 与滚动区卡片点击无效），
// 本驱动改用 DOM 级 .click() + v-model input 事件驱动真实 Vue 处理器，并用 Emulation.setEmulatedMedia
// 控制 prefers-color-scheme（appearance=system 的皮肤解析跟随它）。
// 证据格式与 shoot.mjs 一致：PNG + 每会话 report.json（控制台错误汇总）。
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const URL_APP = "http://localhost:1420";
const OUT = new URL(".", import.meta.url).pathname + "shots";
mkdirSync(OUT, { recursive: true });

const DOC = `远程办公正在重塑城市的生活节奏。过去三年里，越来越多的知识工作者选择离开一线城市，搬到成本更低的小城镇生活。有人据此断言，办公室的时代已经终结，城市将不可避免地走向衰落。
这种结论下得为时过早。远程办公的确改变了部分行业的用工方式，但协同密集型的工作仍然高度依赖面对面的交流。研究显示，视频会议无法完全替代白板前的即兴讨论，也难以复现走廊里的偶然碰撞。
更重要的是，人口流动的数据并不支持单一方向的判断。部分年轻人回流大城市的同时，也有另一批人在小城扎根创业。城市与小镇的兴衰是多重因素交织的结果，把它归因于办公形态的变化，是一种以偏概全的因果推断。
当然，变化是真实的。写字楼空置率上升、通勤高峰错位、社区商业重新布局，这些现象都值得认真对待。问题不在于变化是否发生，而在于我们能否避免用简单的叙事掩盖复杂的现实。
审阅这份文稿时，应当关注论证链条中每一环的强度。结论的力度必须与证据的覆盖面相匹配，这是写作的基本纪律。`;

function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const names = ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge"];
  for (const n of names) {
    const r = spawnSync("which", [n], { encoding: "utf8" });
    if (r.status === 0 && r.stdout.trim()) return r.stdout.trim();
  }
  for (const p of [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  ]) {
    try { readFileSync(p); return p; } catch {}
  }
  throw new Error("没找到 Chrome/Chromium/Edge");
}

const profile = mkdtempSync(join(tmpdir(), "argus-drive-"));
const chrome = spawn(findChrome(), [
  "--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run",
  "--no-default-browser-check", "--hide-scrollbars", "--mute-audio", "--disable-extensions", "about:blank",
], { stdio: ["ignore", "ignore", "pipe"] });
process.on("exit", () => { try { chrome.kill(); } catch {} try { rmSync(profile, { recursive: true, force: true }); } catch {} });

const wsUrl = await new Promise((ok, no) => {
  let buf = "";
  const t = setTimeout(() => no(new Error("浏览器 15 秒内没有启动")), 15000);
  chrome.stderr.on("data", (d) => {
    buf += d;
    const m = buf.match(/DevTools listening on (ws:\/\/\S+)/);
    if (m) { clearTimeout(t); ok(m[1]); }
  });
});
const ws = new WebSocket(wsUrl);
await new Promise((ok, no) => { ws.onopen = ok; ws.onerror = () => no(new Error("连接浏览器失败")); });
let seq = 0;
const pending = new Map();
const listeners = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { const { ok, no } = pending.get(m.id); pending.delete(m.id); m.error ? no(new Error(m.error.message)) : ok(m.result); }
  else if (m.method) listeners.forEach((fn) => fn(m));
};
const send = (method, params = {}, sessionId) => new Promise((ok, no) => {
  const id = ++seq; pending.set(id, { ok, no });
  ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
});
const { targetId } = await send("Target.createTarget", { url: "about:blank" });
const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
const cdp = (m, p) => send(m, p, sessionId);
await cdp("Page.enable");
await cdp("Runtime.enable");

let problems = [];
listeners.push((m) => {
  if (m.sessionId !== sessionId) return;
  if (m.method === "Runtime.exceptionThrown") problems.push(`脚本错误：${(m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text || "").split("\n")[0]}`);
  if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") problems.push(`控制台错误：${m.params.args.map((a) => a.value ?? a.description ?? "").join(" ").slice(0, 200)}`);
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const js = async (code) => {
  const r = await cdp("Runtime.evaluate", { expression: code, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error("页面内执行失败：" + (r.exceptionDetails.exception?.description || r.exceptionDetails.text).split("\n")[0] + " <= " + code.slice(0, 120));
  return r.result.value;
};
const viewport = (w, h, scale = 1) => cdp("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: scale, mobile: false });
const emulateScheme = (v) => cdp("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: v }] });

// 页面内动作原语（DOM 级，绕开合成鼠标的不稳定）
const PRIM = `
const dc = (sel, i = 0) => { const els = document.querySelectorAll(sel); const el = els[i]; if (!el) throw new Error("找不到元素：" + sel + (i ? "#" + i : "") + "（共 " + els.length + " 个）"); el.click(); return true; };
const sv = (sel, val) => { const el = document.querySelector(sel); if (!el) throw new Error("找不到元素：" + sel); el.focus(); el.value = val; el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); return true; };
const hoverIn = (sel, i = 0) => { const el = document.querySelectorAll(sel)[i]; if (!el) throw new Error("找不到元素：" + sel); el.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true })); el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })); return true; };
const waitSel = (sel, ms = 15000) => { const t0 = Date.now(); return new Promise((ok, no) => { const tick = () => { if (document.querySelector(sel)) return ok(true); if (Date.now() - t0 > ms) return no(new Error("等待超时：" + sel)); setTimeout(tick, 120); }; tick(); }); };
const waitGone = (sel, ms = 15000) => { const t0 = Date.now(); return new Promise((ok, no) => { const tick = () => { if (!document.querySelector(sel)) return ok(true); if (Date.now() - t0 > ms) return no(new Error("等待消失超时：" + sel)); setTimeout(tick, 120); }; tick(); }); };
const text = (sel) => (document.querySelector(sel)?.textContent || "").trim();
`;
const prim = async (code) => js(`(async () => { ${PRIM} ${code} })()`);
const open = async (url) => {
  const nav = await cdp("Page.navigate", { url });
  if (nav.errorText) throw new Error("打不开：" + url + " " + nav.errorText);
  await sleep(1200);
  await js(`document.fonts ? document.fonts.ready.then(() => true) : true`);
  await sleep(300);
};
let shotN = 0;
const shot = async (name) => {
  const { data } = await cdp("Page.captureScreenshot", { format: "png" });
  const file = `${OUT}/${name}.png`;
  writeFileSync(file, Buffer.from(data, "base64"));
  shotN++;
  console.log("📸", name);
  return file;
};
// 动效三帧：startScreencast 收集 jpeg 帧，动作后保存 首/中/尾
async function motionFrames(name, action) {
  const frames = [];
  const onFrame = (m) => {
    if (m.sessionId !== sessionId || m.method !== "Page.screencastFrame") return;
    frames.push(Buffer.from(m.params.data, "base64"));
    cdp("Page.screencastFrameAck", { sessionId: m.params.sessionId }).catch(() => {});
  };
  listeners.push(onFrame);
  await cdp("Page.startScreencast", { format: "jpeg", quality: 88, everyNthFrame: 1 });
  await action();
  await sleep(4000);
  await cdp("Page.stopScreencast").catch(() => {});
  listeners.splice(listeners.indexOf(onFrame), 1);
  if (frames.length >= 3) {
    writeFileSync(`${OUT}/${name}-start.jpg`, frames[0]);
    writeFileSync(`${OUT}/${name}-mid.jpg`, frames[Math.floor(frames.length / 2)]);
    writeFileSync(`${OUT}/${name}-end.jpg`, frames[frames.length - 1]);
    console.log(`🎬 ${name}: ${frames.length} 帧 → 三帧已存`);
  } else console.log(`⚠️ ${name}: 只收到 ${frames.length} 帧`);
}

// ================= 会话 A：亮色主链 =================
try {
  emulateScheme("light");
  viewport(1240, 1400);
  await open(URL_APP);
  await prim(`waitSel('.ob-layer')`);
  await shot("01-onboarding-pick-swiss-light");

  await prim(`dc('section.ob-group:nth-of-type(1) .ob-card'); await waitSel('[data-test=ob-preset-key]')`);
  await shot("02-onboarding-preset-swiss-light");
  await prim(`dc('.ob-chead .mini'); await waitSel('.ob-grid'); dc('.ob-alt .ob-card'); await waitSel('.ob-fields input')`);
  await shot("03-onboarding-custom-swiss-light");

  // 配置 mock（自定义连接 → 8932）；sv 后等一拍再点保存，避开 disabled 未刷新的竞态
  await prim(`
    sv('[data-test=ob-custom-baseurl]', 'http://127.0.0.1:8932/v1');
    sv('.ob-fields input[type=password]', 'sk-mock');
    sv('[data-test=ob-custom-model]', 'mock-pro');
    await new Promise(r=>setTimeout(r,200));
    dc('[data-test=ob-save]');
    await waitGone('.ob-layer');
  `);
  await prim(`waitSel('.doc-input')`);
  viewport(1240, 800);
  await prim(`sv('.doc-input', ${JSON.stringify(DOC)}); await new Promise(r=>setTimeout(r,400))`);
  await shot("04-new-review-filled-swiss-light");

  // 开审阅：先收动效帧，再等完成
  await motionFrames("motion-start-review", () => prim(`dc('.new-actions .cta')`));
  await prim(`waitSel('.runstrip', 20000)`);
  await prim(`(async () => { const t0=Date.now(); while(Date.now()-t0<30000){ const b=text('.ws-statusbar .badge'); if(b.includes('完成')||b.includes('失败')) return true; await new Promise(r=>setTimeout(r,200)); } throw new Error('审阅未在 30s 内结束：'+text('.ws-statusbar .badge')); })()`);
  await shot("05-workspace-done-swiss-light");
  viewport(1240, 1400);
  await shot("06-workspace-done-tall-swiss-light");
  viewport(1240, 800);

  await prim(`dc('.side-tab', 1); await new Promise(r=>setTimeout(r,500))`);
  await shot("07-workspace-report-swiss-light");
  await prim(`dc('.side-tab', 0); await new Promise(r=>setTimeout(r,300)); hoverIn('.sidepane .card', 0); await new Promise(r=>setTimeout(r,400))`);
  await shot("08-workspace-hover-card-swiss-light");
  await prim(`dc('.sidepane .card', 1); await new Promise(r=>setTimeout(r,900))`);
  await shot("09-workspace-card-selected-swiss-light");

  await prim(`dc('.psb-acct'); await waitSel('.acct-menu')`);
  await shot("10-acct-menu-swiss-light");
  await prim(`dc('body'); `); // 点空白关菜单
  await prim(`await waitGone('.acct-menu')`);

  // 设置页四组合（长视口）
  await prim(`dc('.ws-statusbar .ws-actions button.mini:not(.primary)'); await waitSel('[data-appearance-option=light]')`);
  viewport(1240, 1600);
  await shot("10a-settings-swiss-light");
  await prim(`dc('[data-theme-option=apple]'); await new Promise(r=>setTimeout(r,400))`);
  await shot("10b-settings-apple-light");
  await prim(`dc('[data-appearance-option=dark]'); await new Promise(r=>setTimeout(r,400))`);
  await shot("10c-settings-apple-dark");
  await prim(`dc('[data-theme-option=swiss]'); await new Promise(r=>setTimeout(r,400))`);
  await shot("10d-settings-swiss-dark");
  // 回亮色瑞士 + 回工作台
  await prim(`dc('[data-appearance-option=light]'); await new Promise(r=>setTimeout(r,300))`);
  viewport(1240, 800);
  await prim(`dc('.psb-row'); await waitSel('.docpane'); await new Promise(r=>setTimeout(r,800))`);
  await shot("11-ws-swiss-light-800");

  const goSet = `dc('.ws-statusbar .ws-actions button.mini:not(.primary)'); await waitSel('[data-appearance-option=light]')`;
  const backWs = `dc('.psb-row'); await waitSel('.docpane'); await new Promise(r=>setTimeout(r,700))`;
  await prim(`${goSet}; dc('[data-appearance-option=dark]'); await new Promise(r=>setTimeout(r,400)); ${backWs}`);
  await shot("12-ws-swiss-dark");
  await prim(`${goSet}; dc('[data-theme-option=apple]'); await new Promise(r=>setTimeout(r,300)); dc('[data-appearance-option=light]'); await new Promise(r=>setTimeout(r,400)); ${backWs}`);
  await shot("13-ws-apple-light");
  await prim(`${goSet}; dc('[data-theme-option=apple]'); await new Promise(r=>setTimeout(r,300)); dc('[data-appearance-option=dark]'); await new Promise(r=>setTimeout(r,400)); ${backWs}`);
  await shot("14-ws-apple-dark");

  // 引导层 apple-dark（从设置页重新运行引导）
  await prim(`${goSet}; dc('[data-theme-option=apple]'); await new Promise(r=>setTimeout(r,300)); dc('[data-appearance-option=dark]'); await new Promise(r=>setTimeout(r,300)); dc('[data-test=rerun-onboarding]'); await waitSel('.ob-layer')`);
  viewport(1240, 1400);
  await shot("15-onboarding-apple-dark");
  await prim(`dc('[data-test=ob-skip]'); await waitGone('.ob-layer')`);
  await prim(`${goSet}; dc('[data-theme-option=swiss]'); await new Promise(r=>setTimeout(r,300)); dc('[data-appearance-option=light]'); await new Promise(r=>setTimeout(r,300)); ${backWs}`);

  // 200% 与宽窗口
  viewport(1240, 800, 2);
  await sleep(300);
  await shot("16-zoom200-ws-swiss-light");
  await prim(`${goSet}; dc('[data-theme-option=apple]'); await new Promise(r=>setTimeout(r,300)); dc('[data-appearance-option=dark]'); await new Promise(r=>setTimeout(r,400)); ${backWs}`);
  await shot("17-zoom200-ws-apple-dark");
  viewport(1600, 1000, 1);
  await prim(`${goSet}; dc('[data-theme-option=swiss]'); await new Promise(r=>setTimeout(r,300)); dc('[data-appearance-option=light]'); await new Promise(r=>setTimeout(r,400)); ${backWs}`);
  await sleep(300);
  await shot("18-ws-wide-swiss-light");
} catch (e) {
  console.log("❌ 会话 A 失败：", e.message);
}

// ================= 会话 B：失败态（死端口，亮色） =================
problems = [];
try {
  await cdp("Page.navigate", { url: "about:blank" });
  emulateScheme("light");
  viewport(1240, 800);
  await open(URL_APP);
  await prim(`waitSel('.ob-layer'); dc('.ob-alt .ob-card'); await waitSel('.ob-fields input')`);
  await prim(`
    sv('[data-test=ob-custom-baseurl]', 'http://127.0.0.1:8933/v1');
    sv('.ob-fields input[type=password]', 'sk-mock');
    sv('[data-test=ob-custom-model]', 'mock-dead');
    await new Promise(r=>setTimeout(r,200));
    dc('[data-test=ob-save]');
    await waitGone('.ob-layer');
  `);
  await prim(`waitSel('.doc-input'); sv('.doc-input', ${JSON.stringify(DOC)}); await new Promise(r=>setTimeout(r,300)); dc('.new-actions .cta')`);
  await prim(`(async () => { const t0=Date.now(); while(Date.now()-t0<30000){ const b=text('.ws-statusbar .badge'); if(b.includes('失败')) return true; await new Promise(r=>setTimeout(r,250)); } return 'timeout:'+text('.ws-statusbar .badge'); })()`);
  await shot("19-run-failed-swiss-light");
} catch (e) {
  console.log("❌ 会话 B 失败：", e.message);
}

writeFileSync(`${OUT}/drive-report.json`, JSON.stringify({ shots: shotN, problems }, null, 2));
console.log("DONE，共", shotN, "张；控制台问题", problems.length, "条");
chrome.kill();
process.exit(0);
