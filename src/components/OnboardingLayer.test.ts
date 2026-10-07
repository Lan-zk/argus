// 任务 2.1–2.4 组件测试（spec: onboarding 引导配置流程 / 跳过与完成 / 主题兼容）。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import OnboardingLayer from "./OnboardingLayer.vue";
import rawSource from "./OnboardingLayer.vue?raw";
import { useSettingsStore } from "../stores/settings";
import { useOnboardingStore } from "../stores/onboarding";
import { useUiStore } from "../stores/ui";

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

/** 挂载引导层：先 start()（active pinia 与组件 plugin pinia 同实例），再挂载。 */
async function mountLayer() {
  const pinia = createPinia();
  setActivePinia(pinia);
  const onb = useOnboardingStore();
  onb.start();
  const w = mount(OnboardingLayer, { global: { plugins: [pinia] } });
  await flushPromises();
  return w;
}

/** 选卡进入 configure 后等待动态 import 工厂链（宏任务翻转，同 SettingsPage.test）。 */
async function settle() {
  await flushPromises();
  await new Promise((r) => setTimeout(r, 50));
  await flushPromises();
}

/** 等待模型下拉目录满足条件（pi-ai 动态 import 链耗时随并发负载波动，轮询代替固定 sleep 防偶发超时）。 */
async function waitForOptions(w: Awaited<ReturnType<typeof mountLayer>>, predicate: (texts: string[]) => boolean) {
  await vi.waitFor(
    async () => {
      await flushPromises();
      const texts = w.findAll("select option").map((o) => o.text());
      if (!predicate(texts)) throw new Error("select options not ready");
    },
    { timeout: 3000, interval: 25 },
  );
}

describe("01 选择服务（pick）", () => {
  it("渲染 hero + 3 预设分组 + 自定义/本地次级入口 + 跳过按钮", async () => {
    const w = await mountLayer();
    expect(w.find(".ob-hero").exists()).toBe(true);
    expect(w.findAll(".ob-group").length).toBe(4); // 3 分组 + 自定义/本地
    expect(w.findAll(".ob-card").length).toBe(36); // 34 预设 + 自定义 + 本地
    expect(w.find('[data-test="ob-skip"]').exists()).toBe(true);
    w.unmount();
  });

  it("点击预设卡进入 preset configure；点击本地模型进入 custom configure（URL 预填）", async () => {
    const w = await mountLayer();
    const deepseek = w.findAll(".ob-card").find((c) => c.text().includes("DeepSeek"))!;
    await deepseek.trigger("click");
    await settle();
    expect(w.find('[data-test="ob-preset-key"]').exists()).toBe(true);

    await w.find(".ob-chead .mini").trigger("click"); // ← 重选服务
    await flushPromises();
    const local = w.findAll(".ob-card").find((c) => c.text().includes("本地模型"))!;
    await local.trigger("click");
    await settle();
    expect((w.find('[data-test="ob-custom-baseurl"]').element as HTMLInputElement).value).toBe(
      "http://localhost:11434/v1",
    );
    w.unmount();
  });
});

describe("02A 预设 configure：Key 失焦自动检索 + 保存完成", () => {
  it("贴 Key 失焦 → 检索合并模型列表 → 保存：首条配置自动默认、关层、落「新建审阅」", async () => {
    mockModelsFetch(["deepseek-v4-pro"]);
    const w = await mountLayer();
    const settings = useSettingsStore();
    const onb = useOnboardingStore();
    const ui = useUiStore();
    ui.go("settings");

    const deepseek = w.findAll(".ob-card").find((c) => c.text().includes("DeepSeek"))!;
    await deepseek.trigger("click");
    await waitForOptions(w, (t) => t.length >= 1); // 静态目录先行

    const save = w.find('[data-test="ob-save"]');
    expect(save.attributes("disabled")).toBeDefined(); // 无 Key 不可保存

    await w.find('[data-test="ob-preset-key"]').setValue("sk-test");
    await w.find('[data-test="ob-preset-key"]').trigger("blur");
    await waitForOptions(w, (t) => t.some((x) => x.includes("deepseek-v4-pro"))); // 300ms 防抖 + 检索合并

    const options = w.findAll("select option");
    expect(options.length).toBeGreaterThan(1); // 静态目录 + 在线检索合并
    expect(options.some((o) => o.text().includes("deepseek-v4-pro"))).toBe(true);

    await w.find('[data-test="ob-save"]').trigger("click");
    await flushPromises();
    expect(settings.models).toHaveLength(1);
    expect(settings.models[0].provider).toBe("deepseek");
    expect(settings.models[0].isDefault).toBe(true); // 首条自动默认
    expect(onb.active).toBe(false);
    expect(ui.reviewView).toBe("new"); // 完成落点
    w.unmount();
  });

  it("检索失败：弱提示可见，保存不阻断（spec: onboarding 检索失败仍可保存）", async () => {
    mockModelsFetch([], 500);
    const w = await mountLayer();
    const deepseek = w.findAll(".ob-card").find((c) => c.text().includes("DeepSeek"))!;
    await deepseek.trigger("click");
    await waitForOptions(w, (t) => t.length >= 1);

    await w.find('[data-test="ob-preset-key"]').setValue("sk-bad");
    await w.find('[data-test="ob-preset-key"]').trigger("blur");
    await vi.waitFor(
      async () => {
        await flushPromises();
        if (!w.text().includes("⚠")) throw new Error("weak hint not shown yet");
      },
      { timeout: 3000, interval: 25 },
    ); // 弱提示

    expect(w.find('[data-test="ob-save"]').attributes("disabled")).toBeUndefined(); // 仍可保存
    w.unmount();
  });
});

describe("02B 自定义 / 本地 configure", () => {
  it("本地模型无需 Key：预填端点、填模型即可保存，baseUrl 入库", async () => {
    const w = await mountLayer();
    const settings = useSettingsStore();
    const local = w.findAll(".ob-card").find((c) => c.text().includes("本地模型"))!;
    await local.trigger("click");
    await settle();

    await w.find('[data-test="ob-custom-model"]').setValue("llama3.1");
    await w.find('[data-test="ob-save"]').trigger("click");
    await flushPromises();
    expect(settings.models).toHaveLength(1);
    expect(settings.models[0].baseUrl).toBe("http://localhost:11434/v1");
    expect(settings.models[0].model).toBe("llama3.1");
    expect(useOnboardingStore().active).toBe(false);
    w.unmount();
  });
});

describe("跳过与交互细节", () => {
  it("Esc 不触发跳过（active 保持）", async () => {
    const w = await mountLayer();
    await w.find(".ob-layer").trigger("keydown", { key: "Escape" });
    expect(useOnboardingStore().active).toBe(true);
    expect(w.find(".ob-layer").exists()).toBe(true);
    w.unmount();
  });

  it("样式零硬编码颜色：style 段无 #hex / rgb(（spec: onboarding 主题兼容）", () => {
    const style = rawSource.slice(rawSource.indexOf("<style"), rawSource.indexOf("</style>"));
    expect(style).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(style).not.toContain("rgb(");
    expect(style).toContain("var(--paper)"); // 不透明背景不透出主界面
  });
});
