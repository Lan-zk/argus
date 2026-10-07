#!/usr/bin/env node
// 评审取证用：项目 scripts/mock-openai-server.mjs 的 CORS 版本（浏览器 dev 模式直连需要跨域头）。
// 行为与原版一致：任意非空 Bearer 通过；submit_report / submit_findings 工具调用；quote 取自请求带行号全文。
import * as http from "node:http";

const PORT = Number(process.env.MOCK_PORT || 8932);
// 取证用：每类响应前的延迟（ms），让"运行中"状态可被截到（MOCK_DELAY_MS=2500 node mock-cors.mjs）
const DELAY = Number(process.env.MOCK_DELAY_MS || 0);

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  // 回显浏览器预检请求的头（OpenAI SDK 会带 x-stainless-* 遥测头，写死白名单会挡掉）
  "access-control-max-age": "86400",
};

function write(res, status, headers, body) {
  res.writeHead(status, { ...CORS, ...headers });
  res.end(body);
}

function sse(res, chunks) {
  res.writeHead(200, { "content-type": "text/event-stream", ...CORS });
  for (const c of chunks) res.write(`data: ${JSON.stringify(c)}\n\n`);
  res.write("data: [DONE]\n\n");
  res.end();
}

function chunkBase(model) {
  return { id: "chatcmpl-mock", object: "chat.completion.chunk", created: 1, model };
}

function toolCallChunks(model, name, argsJson) {
  const base = chunkBase(model);
  return [
    { ...base, choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] },
    {
      ...base,
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [{ index: 0, id: "call_" + Math.random().toString(36).slice(2, 8), type: "function", function: { name, arguments: argsJson } }],
          },
          finish_reason: null,
        },
      ],
    },
    { ...base, choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] },
  ];
}

function extractQuote(bodyText, nth) {
  const re = /L(\d+)\|([^|\n]{10,60})/g;
  let m;
  const hits = [];
  while ((m = re.exec(bodyText)) !== null) hits.push({ line: Number(m[1]), text: m[2].trim() });
  if (!hits.length) return { quote: "样例文档句子", lineHint: 3 };
  const hit = hits[Math.min(nth, hits.length - 1)];
  const stop = hit.text.search(/[。！？!?]/);
  const quote = stop > 4 ? hit.text.slice(0, stop) : hit.text;
  return { quote, lineHint: hit.line };
}

function firstFindingId(bodyText) {
  const m = bodyText.match(/id:"(f\d+)"/);
  return m ? m[1] : "f1";
}

const server = http.createServer((req, res) => {
  if (req.method === "OPTIONS") {
    write(res, 204, { "access-control-allow-headers": req.headers["access-control-request-headers"] || "*" }, "");
    return;
  }
  console.log(new Date().toISOString(), req.method, req.url);
  if (req.url?.includes("/models")) {
    const auth = req.headers["authorization"] || "";
    if (!/^Bearer \S+/.test(auth)) {
      write(res, 401, { "content-type": "application/json" }, JSON.stringify({ error: { message: "Incorrect API key provided", type: "invalid_request_error", code: "invalid_api_key" } }));
      return;
    }
    write(res, 200, { "content-type": "application/json" }, JSON.stringify({ object: "list", data: [{ id: "mock-chat" }, { id: "mock-pro" }, { id: "mock-flash" }] }));
    return;
  }
  if (req.url === "/test") {
    write(res, 200, { "content-type": "application/json" }, JSON.stringify({ ok: true, server: "argus-mock-cors" }));
    return;
  }
  if (!req.url?.includes("/chat/completions")) {
    write(res, 404, {}, "");
    return;
  }
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const respond = () => {
    const auth = req.headers["authorization"] || "";
    if (!/^Bearer \S+/.test(auth)) {
      write(res, 401, { "content-type": "application/json" }, JSON.stringify({ error: { message: "Incorrect API key provided", type: "invalid_request_error", code: "invalid_api_key" } }));
      return;
    }
    let model = "mock-model";
    try {
      model = JSON.parse(body).model ?? model;
    } catch {}
    // 级联取证：按类别序号递增延迟（submit_report 无类别 → 最大延迟，最后落地）
    const catOrder = ["逻辑", "论点", "论证", "修辞", "结构", "清晰度"];
    const catMatch = body.match(/【Category · (.+?)】/);
    const delayFor = catMatch ? DELAY * (catOrder.indexOf(catMatch[1]) + 1) : DELAY * 7;
    if (body.includes("submit_report")) {
      const id = firstFindingId(body);
      const args = JSON.stringify({
        summary: "样例全文审阅完成：结论强度超出论据支持范围，存在以偏概全的因果推断。",
        priorityFindingIds: [id],
        categorySummaries: [{ categoryId: "logic", summary: "逻辑类发现结论扩大问题。" }],
      });
      sse(res, toolCallChunks(model, "submit_report", args));
      return;
    }
    const q0 = extractQuote(body, 0);
    const q1 = extractQuote(body, 1);
    const args = JSON.stringify({
      findings: [
        {
          severity: "high",
          title: "推理跳跃",
          quote: q0.quote,
          lineHint: q0.lineHint,
          contentHash: "0a6bdc87",
          problem: "结论超出前文信息所能支持的范围。",
          reason: "前文只给出单一案例。",
          suggestion: "降低结论强度或补充证据。",
        },
        {
          severity: "low",
          title: "空洞表达",
          quote: q1.quote,
          lineHint: q1.lineHint,
          contentHash: "deadbeef",
          problem: "表述缺乏信息量。",
          reason: "空洞评价不构成论证。",
          suggestion: "替换为具体陈述。",
        },
        {
          severity: "medium",
          title: "结论扩大（多锚演示）",
          quote: q0.quote,
          lineHint: q0.lineHint,
          span: { fromLine: Math.max(1, q0.lineHint - 1), toLine: q0.lineHint + 2 },
          refs: [{ quote: q1.quote, lineHint: q1.lineHint, contentHash: "deadbeef" }],
          problem: "末段结论把第 1 段的单一铺垫扩大为全称判断（整段范围问题，引用见第 1 段）。",
          reason: "论据只覆盖个案，结论按全称表述。",
          suggestion: "把结论限定到论据覆盖的范围。",
        },
      ],
    });
    sse(res, toolCallChunks(model, "submit_findings", args));
    };
    if (delayFor) { setTimeout(respond, delayFor); } else { respond(); }
  });
});

server.listen(PORT, "127.0.0.1", () => console.log(`mock-cors listening on http://127.0.0.1:${PORT}/v1`));
