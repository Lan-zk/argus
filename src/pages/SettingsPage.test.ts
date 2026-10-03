// 任务 3.1–3.4 组件测试：两步流程 / 失焦自动检索 / 自定义连接（spec: settings 模型配置管理）。
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import SettingsPage from "./SettingsPage.vue";
import { useSettingsStore } from "../stores/settings";
import { keyring } from "../lib/keyring";

const REAL_FETCH = globalThis.fetch;

function mockModelsFetch(ids: string[], status = 200) {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ data: ids.map((id) => ({ id })) }), {
      status,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;
}

beforeEach(() => {
  setActivePinia(createPinia());
});
afterEach(() => {
  globalThis.fetch = REAL_FETCH;
});

/** 挂载页面：active pinia 与组件 plugin pinia 必须是同一实例（断言才落在同一 store）。 */
async function mountPage() {
  const pinia = createPinia();
  setActivePinia(pinia);
  const w = mount(SettingsPage, { global: { plugins: [pinia] } });
  await flushPromises();
  return w;
}

describe("3.1 第一步：选服务", () => {
  it("pick 步渲染 29 个预设卡片（3 分组）+ 自定义连接 + 本地模型", async () => {
    const w = await mountPage();
    await w.find("section .set-sec > button").trigger("click"); // ＋ 新增模型配置
    expect(w.findAll(".preset-group").length).toBeGreaterThanOrEqual(4); // 3 分组 + 兜底组
    expect(w.findAll(".preset-card").length).toBe(36); // 34 预设 + 自定义 + 本地
    const labels = w.findAll(".preset-group > .microlabel").map((l) => l.text());
    expect(labels).toContain("国内服务");
    expect(labels).toContain("国际服务");
    expect(labels).toContain("聚合平台");
    w.unmount();
  });
});

describe("3.2/3.3 预设 configure：唯一必填 Key + 失焦自动检索", () => {
  it("选中 DeepSeek → 静态目录先行（离线），推荐默认预选", async () => {
    const w = await mountPage();
    await w.find("section .set-sec > button").trigger("click");
    const deepseek = w.findAll(".preset-card").find((c) => c.text().includes("DeepSeek"))!;
    await deepseek.trigger("click");
    await flushPromises();
    await new Promise((r) => setTimeout(r, 50)); // 动态 import 工厂链需要宏任务翻转
    await flushPromises();
    // API Key 为唯一文本输入；模型下拉来自静态目录
    const select = w.find("select");
    const options = select.findAll("option");
    expect(options.length).toBeGreaterThanOrEqual(2);
    expect((select.element as HTMLSelectElement).value).toBe("deepseek-flash");
    const opt = options.find((o) => o.text().includes("deepseek-flash"))!;
    expect(opt.text()).toContain("推荐");
    expect(opt.text()).toContain("k ctx");
    w.unmount();
  });

  it("Key 失焦且非空 → 防抖后自动检索并合并去重（在线模型补入）", async () => {
    mockModelsFetch(["deepseek-flash", "deepseek-online-x"]);
    const w = await mountPage();
    await w.find("section .set-sec > button").trigger("click");
    await w.findAll(".preset-card").find((c) => c.text().includes("DeepSeek"))!.trigger("click");
    await flushPromises();
    await new Promise((r) => setTimeout(r, 50)); // 动态 import 工厂链需要宏任务翻转
    await flushPromises();
    const before = w.find("select").findAll("option").length;
    const keyInput = w.find('input[type="password"]');
    await keyInput.setValue("sk-test-key-1");
    await keyInput.trigger("blur");
    await new Promise((r) => setTimeout(r, 450)); // 300ms 防抖 + fetch
    await flushPromises();
    const options = w.find("select").findAll("option").map((o) => o.text());
    expect(options.length).toBe(before + 1); // deepseek-online-x 新增；deepseek-flash 去重不重复
    expect(options.join()).toContain("deepseek-online-x");
    w.unmount();
  });

  it("Key 为空失焦 → 不发起检索", async () => {
    let called = 0;
    globalThis.fetch = (async () => {
      called++;
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
    const w = await mountPage();
    await w.find("section .set-sec > button").trigger("click");
    await w.findAll(".preset-card").find((c) => c.text().includes("DeepSeek"))!.trigger("click");
    await flushPromises();
    await new Promise((r) => setTimeout(r, 50)); // 动态 import 工厂链需要宏任务翻转
    await flushPromises();
    const keyInput = w.find('input[type="password"]');
    await keyInput.setValue("  ");
    await keyInput.trigger("blur");
    await new Promise((r) => setTimeout(r, 450));
    expect(called).toBe(0);
    w.unmount();
  });

  it("检索 401 → 可读弱提示，目录与选择不阻断", async () => {
    mockModelsFetch([], 401);
    const w = await mountPage();
    await w.find("section .set-sec > button").trigger("click");
    await w.findAll(".preset-card").find((c) => c.text().includes("DeepSeek"))!.trigger("click");
    await flushPromises();
    await new Promise((r) => setTimeout(r, 50)); // 动态 import 工厂链需要宏任务翻转
    await flushPromises();
    const keyInput = w.find('input[type="password"]');
    await keyInput.setValue("sk-bad");
    await keyInput.trigger("blur");
    await new Promise((r) => setTimeout(r, 450));
    await flushPromises();
    const microlabels = w.findAll(".microlabel").map((l) => l.text()).join();
    expect(microlabels).toContain("API Key 无效");
    expect(w.find("select").findAll("option").length).toBeGreaterThanOrEqual(2); // 目录仍在
    w.unmount();
  });

  it("保存预设 → store 落配置 + 钥匙串有条目", async () => {
    const w = await mountPage();
    const settings = useSettingsStore(); // 必须在 mountPage 之后取（同一 active pinia）
    await w.find("section .set-sec > button").trigger("click");
    await w.findAll(".preset-card").find((c) => c.text().includes("DeepSeek"))!.trigger("click");
    await flushPromises();
    await new Promise((r) => setTimeout(r, 50)); // 动态 import 工厂链需要宏任务翻转
    await flushPromises();
    const keyInput = w.find('input[type="password"]');
    await keyInput.setValue("sk-persist-me");
    // 不依赖检索直接保存（目录默认已预选）
    const save = w.findAll("button").find((b) => b.text() === "保存")!;
    await save.trigger("click");
    await flushPromises();
    await new Promise((r) => setTimeout(r, 20)); // 钥匙串+持久化异步链需要宏任务翻转
    await flushPromises();
    expect(settings.models).toHaveLength(1);
    expect(settings.models[0].provider).toBe("deepseek");
    expect(settings.models[0].model).toBe("deepseek-flash");
    expect(await keyring.get(settings.models[0].id)).toBe("sk-persist-me");
    // 规格约束的是数据文件不落明文：校验持久化层输出（内存 store 保留 Key 供调用快路径，系 MVP 既有行为）
    const persisted = await import("../lib/persistence").then((m) => m.loadState());
    expect(JSON.stringify(persisted.settings.models)).not.toContain("sk-persist-me");
    w.unmount();
  });
});

describe("displayName 显示名称（spec: settings 显示名称场景）", () => {
  it("设置了 displayName 的行优先展示，模型 id 退为副标签", async () => {
    const w = await mountPage();
    const settings = useSettingsStore();
    await settings.addModel({ provider: "deepseek", model: "deepseek-flash", apiKey: "k", displayName: "公司主力" });
    await settings.addModel({ provider: "deepseek", model: "deepseek-v4-pro", apiKey: "k" });
    await flushPromises();
    const rows = w.findAll(".model-row");
    const withName = rows[0].find(".mr-top");
    expect(withName.find("b").text()).toBe("公司主力");
    expect(withName.text()).toContain("deepseek-flash"); // 模型 id 副标签
    // 未设置：回退为 bold=model（服务名 · 模型 ID 形态）
    expect(rows[1].find(".mr-top b").text()).toBe("deepseek-v4-pro");
    w.unmount();
  });

  it("自定义连接可填显示名称并保存", async () => {
    const w = await mountPage();
    await w.find("section .set-sec > button").trigger("click");
    await w.findAll(".preset-card").find((c) => c.text().includes("自定义连接"))!.trigger("click");
    await flushPromises();
    const nameInput = w.find('input[placeholder*="自定义 ·"]');
    await nameInput.setValue("硅基流动-闪");
    const baseUrl = w.find('input[placeholder*="api/paas"]');
    await baseUrl.setValue("https://api.siliconflow.cn/v1");
    const modelInput = w.find('input[list="custom-model-list"]');
    await modelInput.setValue("Qwen/Qwen3-8B");
    await w.findAll("button").find((b) => b.text() === "保存")!.trigger("click");
    await flushPromises();
    await new Promise((r) => setTimeout(r, 20));
    const settings = useSettingsStore();
    expect(settings.models[0].displayName).toBe("硅基流动-闪");
    expect(settings.models[0].model).toBe("Qwen/Qwen3-8B");
    w.unmount();
  });

  it("编辑已有配置改名不影响其他字段", async () => {
    const w = await mountPage();
    const settings = useSettingsStore();
    const m = await settings.addModel({ provider: "deepseek", model: "deepseek-flash", apiKey: "k" });
    await flushPromises();
    await w.findAll("button").find((b) => b.text() === "编辑")!.trigger("click");
    await flushPromises();
    const nameInput = w.find('input[placeholder*="服务名 · 模型 ID"]');
    await nameInput.setValue("改名X");
    await w.findAll("button").find((b) => b.text() === "保存")!.trigger("click");
    await flushPromises();
    await new Promise((r) => setTimeout(r, 20));
    expect(settings.models[0].displayName).toBe("改名X");
    expect(settings.models[0].model).toBe("deepseek-flash");
    expect(settings.models[0].provider).toBe("deepseek");
    void m;
    w.unmount();
  });
});

describe("2.4 编辑表单按配置来源分流（spec: settings 编辑预设配置沿用预设形态）", () => {
  it("编辑预设配置 → 预设形态：模型下拉（含目录与当前值）、Key 留空=保持、无 BaseURL 字段", async () => {
    const w = await mountPage();
    const settings = useSettingsStore();
    await settings.addModel({ provider: "deepseek", model: "deepseek-flash", apiKey: "k" });
    await flushPromises();
    await w.findAll("button").find((b) => b.text() === "编辑")!.trigger("click");
    await flushPromises();
    await new Promise((r) => setTimeout(r, 50)); // 目录懒加载
    await flushPromises();
    const html = w.html();
    expect(html).toContain("端点已内置"); // 预设形态标识
    expect(html).not.toContain("Base URL"); // 不出现自定义字段
    const select = w.find("select");
    expect((select.element as HTMLSelectElement).value).toBe("deepseek-flash"); // 当前值选中
    expect(select.findAll("option").length).toBeGreaterThanOrEqual(2); // 目录选项
    expect(html).toContain("留空 = 保持已存 Key");
    w.unmount();
  });

  it("编辑自定义配置 → 全字段形态：Base URL 可见可改", async () => {
    const w = await mountPage();
    const settings = useSettingsStore();
    await settings.addModel({
      provider: "openai-compatible",
      model: "m1",
      apiKey: "k",
      baseUrl: "https://a.example/v1",
    });
    await flushPromises();
    await w.findAll("button").find((b) => b.text() === "编辑")!.trigger("click");
    await flushPromises();
    const html = w.html();
    expect(html).toContain("Base URL");
    expect(html).not.toContain("端点已内置");
    w.unmount();
  });

  it("预设编辑改选模型保存生效", async () => {
    const w = await mountPage();
    const settings = useSettingsStore();
    await settings.addModel({ provider: "deepseek", model: "deepseek-flash", apiKey: "k" });
    await flushPromises();
    await w.findAll("button").find((b) => b.text() === "编辑")!.trigger("click");
    await flushPromises();
    await new Promise((r) => setTimeout(r, 50));
    await flushPromises();
    const select = w.find("select");
    await select.setValue("deepseek-v4-pro");
    await w.findAll("button").find((b) => b.text() === "保存")!.trigger("click");
    await flushPromises();
    await new Promise((r) => setTimeout(r, 20));
    expect(settings.models[0].model).toBe("deepseek-v4-pro");
    expect(settings.models[0].provider).toBe("deepseek");
    w.unmount();
  });
});

describe("3.4 自定义连接", () => {
  it("全字段表单 + 检索按钮填充模型 + 手动输入并存", async () => {
    mockModelsFetch(["srv-a", "srv-b"]);
    const w = await mountPage();
    await w.find("section .set-sec > button").trigger("click");
    await w.findAll(".preset-card").find((c) => c.text().includes("自定义连接"))!.trigger("click");
    await flushPromises();
    expect(w.find('input[placeholder*="api/paas"]').exists()).toBe(true); // Base URL
    const fetchBtn = w.findAll("button").find((b) => b.text() === "检索模型")!;
    const baseUrl = w.find('input[placeholder*="api/paas"]');
    await baseUrl.setValue("http://127.0.0.1:8931/v1");
    await fetchBtn.trigger("click");
    await flushPromises();
    const modelInput = w.find('input[list="custom-model-list"]');
    expect((modelInput.element as HTMLInputElement).value).toBe("srv-a"); // 检索后预选第一个
    await modelInput.setValue("my-manual-model"); // 手动覆盖始终允许
    const save = w.findAll("button").find((b) => b.text() === "保存")!;
    await save.trigger("click");
    await flushPromises();
    const settings = useSettingsStore();
    expect(settings.models[0].model).toBe("my-manual-model");
    expect(settings.models[0].provider).toBe("openai-compatible");
    w.unmount();
  });

  it("本地模型入口预填 Ollama BaseURL", async () => {
    const w = await mountPage();
    await w.find("section .set-sec > button").trigger("click");
    await w.findAll(".preset-card").find((c) => c.text().includes("本地模型"))!.trigger("click");
    await flushPromises();
    expect((w.find('input[placeholder*="api/paas"]').element as HTMLInputElement).value).toBe(
      "http://localhost:11434/v1",
    );
    w.unmount();
  });
});
