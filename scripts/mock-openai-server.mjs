#!/usr/bin/env node
// 本地 OpenAI-compatible mock server（spike/联调用）。
// 实现最小 chat/completions（SSE 流式 + tool_calls），行为：
//  - Authorization: Bearer <任意非空> 通过；缺失/空 → 401 JSON
//  - 请求含 "submit_report" → 返回 submit_report 工具调用（引用请求中出现的第一个 finding id）
//  - 其余 → 返回 submit_findings 工具调用；quote 从请求带行号全文中提取真实句子，lineHint 用其行号（保证可定位）
//  - /test → {"ok":true}
import * as http from "node:http";

const PORT = Number(process.env.MOCK_PORT || 8931);

// CORS：浏览器 dev 模式（纯 vite，原生 fetch）下联调用；tauri 侧经 Rust 通道不受影响。
const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "authorization, content-type",
};

function sse(res, chunks) {
  res.writeHead(200, { "content-type": "text/event-stream", ...CORS_HEADERS });
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

/** 从带行号全文（L{n}|句子）中提取第 n 段真实句子作 quote。 */
function extractQuote(bodyText, nth) {
  const re = /L(\d+)\|([^|\n]{10,60})/g;
  let m;
  const hits = [];
  while ((m = re.exec(bodyText)) !== null) hits.push({ line: Number(m[1]), text: m[2].trim() });
  if (!hits.length) return { quote: "样例文档句子", lineHint: 3 };
  const hit = hits[Math.min(nth, hits.length - 1)];
  // 取句号前的部分作 quote，避免句末标点归一化差异问题（hash 归一化只去空白，标点保留）
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
    // 回显预检请求头：OpenAI SDK 会带 x-stainless-* 等额外头，固定白名单会挡掉真实客户端
    const requested = req.headers["access-control-request-headers"];
    res.writeHead(204, {
      ...CORS_HEADERS,
      ...(requested ? { "access-control-allow-headers": requested } : {}),
    });
    res.end();
    return;
  }
  // OpenAI 兼容模型列表端点（model-config-ux 联调用）
  if (req.url?.includes("/models")) {
    const auth = req.headers["authorization"] || "";
    if (!/^Bearer \S+/.test(auth)) {
      res.writeHead(401, { "content-type": "application/json", ...CORS_HEADERS });
      res.end(JSON.stringify({ error: { message: "Incorrect API key provided", type: "invalid_request_error", code: "invalid_api_key" } }));
      return;
    }
    res.writeHead(200, { "content-type": "application/json", ...CORS_HEADERS });
    res.end(JSON.stringify({ object: "list", data: [{ id: "mock-chat" }, { id: "mock-pro" }, { id: "mock-flash" }] }));
    return;
  }
  if (req.url === "/test") {
    res.writeHead(200, { "content-type": "application/json", ...CORS_HEADERS });
    res.end(JSON.stringify({ ok: true, server: "argus-mock" }));
    return;
  }
  if (!req.url?.includes("/chat/completions")) {
    res.writeHead(404);
    res.end();
    return;
  }
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const auth = req.headers["authorization"] || "";
    if (!/^Bearer \S+/.test(auth)) {
      res.writeHead(401, { "content-type": "application/json", ...CORS_HEADERS });
      res.end(JSON.stringify({ error: { message: "Incorrect API key provided", type: "invalid_request_error", code: "invalid_api_key" } }));
      return;
    }
    let model = "mock-model";
    try {
      model = JSON.parse(body).model ?? model;
    } catch {}
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
    // 类别审阅：三条 findings，quote 取自请求中的真实句子（第 0、1 段命中）。
    // 第三条演示 span/refs 多锚输出（spec: finding-anchor-spans）：行范围主锚 + 指向第 1 段的引用锚。
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
  });
});

server.listen(PORT, "127.0.0.1", () => console.log(`mock-openai listening on http://127.0.0.1:${PORT}/v1`));
