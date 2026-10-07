// 任务 3.1–3.4 组件测试：两步流程 / 失焦自动检索 / 自定义连接（spec: settings 模型配置管理）。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import SettingsPage from "./SettingsPage.vue";
import { useSettingsStore } from "../stores/settings";
import { useOnboardingStore } from "../stores/onboarding";
import { useUpdateStore } from "../stores/update";
import { useUiStore } from "../stores/ui";
import { useThemeStore } from "../stores/theme";
import { loadState } from "../lib/persistence";
import { keyring } from "../lib/keyring";
import { resetRepoForTests } from "../lib/repo";

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

/** 等待模型下拉目录满足条件（pi-ai 动态 import 工厂链耗时随并发负载波动，轮询代替固定 sleep 防偶发超时）。 */
async function waitForOptions(w: Awaited<ReturnType<typeof mountPage>>, predicate: (texts: string[]) => boolean) {
  await vi.waitFor(
    async () => {
      await flushPromises();
      const texts = w.findAll("select option").map((o) => o.text());
      if (!predicate(texts)) throw new Error("select options not ready");
    },
    { timeout: 3000, interval: 25 },
  );
}

describe("3.1 第一步：选服务", () => {
  it("pick 步渲染 29 个预设卡片（3 分组）+ 自定义连接 + 本地模型", async () => {
    const w = await mountPage();
    await w.find("section .set-sec .set-tail > button").trigger("click"); // ＋ 新增模型配置
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
    await w.find("section .set-sec .set-tail > button").trigger("click");
    const deepseek = w.findAll(".preset-card").find((c) => c.text().includes("DeepSeek"))!;
    await deepseek.trigger("click");
    await waitForOptions(w, (t) => t.length >= 2 && t.some((x) => x.includes("deepseek-flash")));
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
    await w.find("section .set-sec .set-tail > button").trigger("click");
    await w.findAll(".preset-card").find((c) => c.text().includes("DeepSeek"))!.trigger("click");
    await waitForOptions(w, (t) => t.length >= 1);
    const before = w.find("select").findAll("option").length;
    const keyInput = w.find('input[type="password"]');
    await keyInput.setValue("sk-test-key-1");
    await keyInput.trigger("blur");
    await waitForOptions(w, (t) => t.some((x) => x.includes("deepseek-online-x"))); // 300ms 防抖 + fetch
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
    await w.find("section .set-sec .set-tail > button").trigger("click");
    await w.findAll(".preset-card").find((c) => c.text().includes("DeepSeek"))!.trigger("click");
    await waitForOptions(w, (t) => t.length >= 1);
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
    await w.find("section .set-sec .set-tail > button").trigger("click");
    await w.findAll(".preset-card").find((c) => c.text().includes("DeepSeek"))!.trigger("click");
    await waitForOptions(w, (t) => t.length >= 2);
    const keyInput = w.find('input[type="password"]');
    await keyInput.setValue("sk-bad");
    await keyInput.trigger("blur");
    await vi.waitFor(
      async () => {
        await flushPromises();
        if (!w.findAll(".microlabel").map((l) => l.text()).join().includes("API Key 无效")) {
          throw new Error("401 weak hint not shown yet");
        }
      },
      { timeout: 3000, interval: 25 },
    );
    const microlabels = w.findAll(".microlabel").map((l) => l.text()).join();
    expect(microlabels).toContain("API Key 无效");
    expect(w.find("select").findAll("option").length).toBeGreaterThanOrEqual(2); // 目录仍在
    w.unmount();
  });

  it("保存预设 → store 落配置 + 钥匙串有条目", async () => {
    const w = await mountPage();
    const settings = useSettingsStore(); // 必须在 mountPage 之后取（同一 active pinia）
    await w.find("section .set-sec .set-tail > button").trigger("click");
    await w.findAll(".preset-card").find((c) => c.text().includes("DeepSeek"))!.trigger("click");
    await waitForOptions(w, (t) => t.length >= 1);
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
    await w.find("section .set-sec .set-tail > button").trigger("click");
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
    await waitForOptions(w, (t) => t.length >= 2 && t.some((x) => x.includes("deepseek-flash"))); // 目录懒加载
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
    await waitForOptions(w, (t) => t.some((x) => x.includes("deepseek-v4-pro")));
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
    await w.find("section .set-sec .set-tail > button").trigger("click");
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
    await w.find("section .set-sec .set-tail > button").trigger("click");
    await w.findAll(".preset-card").find((c) => c.text().includes("本地模型"))!.trigger("click");
    await flushPromises();
    expect((w.find('input[placeholder*="api/paas"]').element as HTMLInputElement).value).toBe(
      "http://localhost:11434/v1",
    );
    w.unmount();
  });
});

describe("3.3 Appearance 外观（spec: theme-system 主题与明暗双轴独立选择）", () => {
  it("渲染主题与明暗两组选项，默认 swiss + system", async () => {
    const w = await mountPage();
    const themes = w.findAll("[data-theme-option]");
    const appearances = w.findAll("[data-appearance-option]");
    expect(themes.map((t) => t.text())).toEqual(["瑞士风格", "Apple 风格"]);
    expect(appearances.map((a) => a.text())).toEqual(["亮色", "暗色", "跟随系统"]);
    expect(w.find("[data-theme-option='swiss']").classes()).toContain("on");
    expect(w.find("[data-appearance-option='system']").classes()).toContain("on");
    w.unmount();
  });

  it("点击主题/明暗即切换 data-theme 并持久化偏好", async () => {
    const w = await mountPage();
    const settings = useSettingsStore();
    // 主题应用由 main.ts start()；测试中显式启动后 DOM 属性才随偏好联动
    useThemeStore().start();

    await w.find("[data-theme-option='apple']").trigger("click");
    await flushPromises();
    expect(document.documentElement.dataset.theme).toBe("apple-light");
    expect(settings.ui.theme).toBe("apple");

    await w.find("[data-appearance-option='dark']").trigger("click");
    await flushPromises();
    expect(document.documentElement.dataset.theme).toBe("apple-dark");
    expect(settings.ui.appearance).toBe("dark");

    const loaded = await loadState();
    expect(loaded.settings.ui.theme).toBe("apple");
    expect(loaded.settings.ui.appearance).toBe("dark");
    w.unmount();
  });
});

describe("onboarding 重看入口（spec: onboarding 手动重看入口）", () => {
  it("「重新运行引导」唤醒：active 置位；跳过后回设置页且标记保持已完成", async () => {
    const w = await mountPage();
    const onb = useOnboardingStore();
    const ui = useUiStore();
    ui.go("settings");
    await w.find('[data-test="rerun-onboarding"]').trigger("click");
    expect(onb.active).toBe(true);

    await onb.skip();
    expect(ui.page).toBe("settings"); // 回到进入前页面
    expect((await loadState()).settings.ui.onboarded).toBe(true); // 标记保持已完成
    w.unmount();
  });
});

describe("类别分组（spec: settings 类别分组管理）", () => {
  beforeEach(() => {
    resetRepoForTests(); // 干净存储：默认类别由 init 重新种子
  });

  /** 挂载并初始化设置（种入默认类别，分节才有内容）。 */
  async function mountWithCategories() {
    const w = await mountPage();
    const settings = useSettingsStore();
    await settings.init();
    await flushPromises();
    return { w, settings };
  }

  function sectionNames(w: Awaited<ReturnType<typeof mountPage>>): string[] {
    return w.findAll("[data-group-sec]").map((s) => s.find(".grp-head b").text());
  }

  it("类别列表按组分节展示，通用虚拟组置顶（spec: 设置页类别列表按分组分节）", async () => {
    const { w, settings } = await mountWithCategories();
    const g = await settings.addGroup("小说");
    await settings.assignCategoryGroup("logic", g.id);
    await flushPromises();
    expect(sectionNames(w)).toEqual(["通用", "小说"]); // 通用恒为首位
    const secs = w.findAll("[data-group-sec]");
    expect(secs[1].text()).toContain("逻辑"); // logic 落在小说分节
    expect(secs[0].text()).not.toContain("逻辑");
    // 通用分节无删除入口（虚拟组不可删）
    expect(secs[0].find('[data-test="group-delete"]').exists()).toBe(false);
    expect(secs[1].find('[data-test="group-delete"]').exists()).toBe(true);
    w.unmount();
  });

  it("新建分组入口：命名后入列表并渲染分节", async () => {
    const { w, settings } = await mountWithCategories();
    await w.find('[data-test="add-group"]').trigger("click");
    await w.find('[data-test="new-group-name"]').setValue("讲道稿");
    await w.find('[data-test="new-group-ok"]').trigger("click");
    await flushPromises();
    expect(settings.groups.map((g) => g.name)).toEqual(["讲道稿"]);
    expect(sectionNames(w)).toEqual(["通用", "讲道稿"]);
    w.unmount();
  });

  it("重命名分组同步分节标题（spec: 重命名分组同步切换器）", async () => {
    const { w, settings } = await mountWithCategories();
    const g = await settings.addGroup("讲道");
    await flushPromises();
    const sec = w.findAll("[data-group-sec]")[1];
    await sec.findAll("button").find((b) => b.text() === "重命名")!.trigger("click");
    await w.find('[data-test="group-rename-input"]').setValue("讲道稿");
    await w.findAll("button").find((b) => b.text() === "确定")!.trigger("click");
    await flushPromises();
    expect(settings.groups[0].name).toBe("讲道稿");
    expect(sectionNames(w)).toEqual(["通用", "讲道稿"]);
    void g;
    w.unmount();
  });

  it("删除分组：确认文案含「N 个类别将移回通用」，确认后组移除、类别回落通用分节", async () => {
    const { w, settings } = await mountWithCategories();
    const g = await settings.addGroup("小说");
    await settings.assignCategoryGroup("logic", g.id);
    await settings.assignCategoryGroup("clarity", g.id);
    await flushPromises();
    expect(w.find('[data-test="group-delete-confirm"]').exists()).toBe(false);
    await w.find('[data-test="group-delete"]').trigger("click");
    const confirm = w.find('[data-test="group-delete-confirm"]');
    expect(confirm.text()).toContain("2 个类别将移回通用");
    expect(confirm.text()).toContain("类别本身不会被删除");
    await w.find('[data-test="group-delete-confirm-ok"]').trigger("click");
    await flushPromises();
    expect(settings.groups).toHaveLength(0);
    expect(sectionNames(w)).toEqual(["通用"]); // 只剩通用分节
    expect(settings.categories.find((c) => c.id === "logic")?.groupId ?? null).toBeNull();
    expect(w.find("[data-group-sec]").text()).toContain("逻辑"); // 类别仍在列表（通用节）
    w.unmount();
  });

  it("编辑区「所属分组」选择器：调整后分节即时重排（spec: 调整类别归属）", async () => {
    const { w, settings } = await mountWithCategories();
    const g = await settings.addGroup("小说");
    await flushPromises();
    // 打开「逻辑」编辑区并切分组
    const logicRow = w.findAll(".cat-set-row").find((r) => r.text().includes("逻辑"))!;
    await logicRow.find("button.mini.primary").trigger("click"); // 编辑 Prompt（展开编辑区）
    await logicRow.find('[data-test="cat-group-select"]').setValue(g.id);
    await flushPromises();
    expect(settings.categories.find((c) => c.id === "logic")?.groupId).toBe(g.id);
    const secs = w.findAll("[data-group-sec]");
    expect(secs[0].text()).not.toContain("逻辑"); // 移出通用
    expect(secs[1].text()).toContain("逻辑"); // 移入小说
    w.unmount();
  });
});

// 「关于 · 检查更新」区块（spec: app-updates 版本检查时机）：unsupported 降级仅版本号；
// 状态行各态渲染。状态机流转（静默/手动/下载安装）由 update.test.ts 覆盖，此处只验证 UI 呈现。
describe("About 关于 · 检查更新", () => {
  it("浏览器测试环境（unsupported）：仅显示版本号占位与提示，无检查按钮", async () => {
    const w = await mountPage();
    const sec = w.find('[data-test="about-sec"]');
    expect(sec.exists()).toBe(true);
    expect(sec.find('[data-test="about-version"]').text()).toContain("Argus v—");
    expect(sec.find('[data-test="update-check"]').exists()).toBe(false);
    expect(sec.text()).toContain("桌面应用");
    w.unmount();
  });

  it("up-to-date：状态行显示已是最新（accent）", async () => {
    const w = await mountPage();
    const update = useUpdateStore();
    update.$patch({ status: "up-to-date" });
    await flushPromises();
    expect(w.find('[data-test="update-status"]').text()).toContain("已是最新");
    w.unmount();
  });

  it("available：显示新版本号并提供「立即更新」", async () => {
    const w = await mountPage();
    const update = useUpdateStore();
    update.$patch({ status: "available", pending: { version: "0.2.0", notes: "" } });
    await flushPromises();
    expect(w.find('[data-test="update-status"]').text()).toContain("v0.2.0");
    expect(w.find('[data-test="about-update-accept"]').text()).toContain("立即更新");
    w.unmount();
  });

  it("check-failed：错误文案以 danger 色呈现", async () => {
    const w = await mountPage();
    const update = useUpdateStore();
    update.$patch({ status: "check-failed", error: "检查更新失败：网络错误" });
    await flushPromises();
    const line = w.find('[data-test="update-status"]');
    expect(line.text()).toContain("网络错误");
    expect(line.attributes("style")).toContain("var(--danger)");
    w.unmount();
  });

  it("downloading：进度百分比随 store 更新", async () => {
    const w = await mountPage();
    const update = useUpdateStore();
    update.$patch({ status: "downloading", progress: 37 });
    await flushPromises();
    expect(w.find('[data-test="update-status"]').text()).toContain("37%");
    update.$patch({ progress: null });
    await flushPromises();
    expect(w.find('[data-test="update-status"]').text()).not.toContain("%");
    w.unmount();
  });
});
