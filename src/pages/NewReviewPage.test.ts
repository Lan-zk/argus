// 开始审阅交互（spec: review-ui 加载反馈可达性 + 双开守卫 + 早失败可见）。
import { describe, expect, it, vi, beforeEach } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import NewReviewPage from "./NewReviewPage.vue";
import { useSettingsStore } from "../stores/settings";
import { useSessionStore } from "../stores/session";
import { useUiStore } from "../stores/ui";
import { keyring } from "../lib/keyring";
import { defaultSettings, saveSettings } from "../lib/persistence";

async function mountReady() {
  const pinia = createPinia();
  setActivePinia(pinia);
  const w = mount(NewReviewPage, { global: { plugins: [pinia] } });
  const settings = useSettingsStore();
  await settings.init(); // 种入默认类别，勾选态随 loaded 初始化
  await settings.addModel({ provider: "deepseek", model: "deepseek-flash", apiKey: "k" });
  settings.draftText = "# 标题\n\n需要审阅的正文内容。";
  await flushPromises();
  return { w, settings };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("立即跳转与进度可见", () => {
  it("点击开始审阅后立即进入工作台（不等审阅完成）", async () => {
    const { w } = await mountReady();
    const session = useSessionStore();
    const ui = useUiStore();
    let resolve!: () => void;
    const pending = new Promise<void>((r) => (resolve = r));
    vi.spyOn(session, "startReview").mockReturnValue(pending as never);

    await w.find("button.primary").trigger("click");
    await flushPromises();
    // 审阅 promise 仍挂起，页面已在工作台
    expect(ui.page).toBe("workspace");
    resolve();
    await pending;
    w.unmount();
  });

  it("审阅进行中：开始按钮禁用并提示前往工作台（双开守卫）", async () => {
    const { w } = await mountReady();
    const session = useSessionStore();
    const ui = useUiStore();
    session.session = {
      id: "s1", documentId: "d", selectedCategoryIds: ["logic"], status: "running", createdAt: new Date().toISOString(),
    };
    await flushPromises();
    const btn = w.find("button.primary");
    expect(btn.attributes("disabled")).toBeDefined();
    expect(btn.text()).toContain("审阅进行中");
    expect(w.text()).toContain("审阅工作台");
    expect(ui.page).toBe("new");
    w.unmount();
  });
});

describe("启动失败的可见性", () => {
  it("启动即失败（无 run）→ 跳回新建页并显示错误", async () => {
    const { w } = await mountReady();
    const session = useSessionStore();
    const ui = useUiStore();
    vi.spyOn(session, "startReview").mockRejectedValue(new Error("没有可用模型配置"));
    await w.find("button.primary").trigger("click");
    await flushPromises();
    expect(ui.page).toBe("new");
    expect(w.find(".errbox").text()).toContain("没有可用模型配置");
    w.unmount();
  });

  it("启动链路中途异常（钥匙串读取失败）→ 未终态 run 标失败可重跑，不永久等待", async () => {
    setActivePinia(createPinia());
    const settings = useSettingsStore();
    await settings.init();
    const m = await settings.addModel({ provider: "deepseek", model: "deepseek-flash", apiKey: "k" });
    settings.models[0].apiKey = undefined; // 模拟重启恢复形态：Key 只在钥匙串
    vi.spyOn(keyring, "get").mockRejectedValue(new Error("钥匙串读取失败"));
    const session = useSessionStore();
    await expect(session.startReview("# t\n\n正文", ["logic"])).rejects.toThrow("钥匙串读取失败");
    const rs = session.runList;
    expect(rs.length).toBeGreaterThanOrEqual(1);
    for (const r of rs) {
      expect(r.status).toBe("failed");
      expect(r.error).toContain("钥匙串读取失败");
    }
    expect(session.session?.status).toBe("failed");
    void m;
  });
});

describe("双栏独立滚动布局（spec: 新建审阅页双栏独立滚动与操作常驻）", () => {
  it("根节点具备 page-new class（页面级不滚动、两栏各自滚动的结构前提）", async () => {
    const { w } = await mountReady();
    expect(w.find("section.page").classes()).toContain("page-new");
    w.unmount();
  });
});

describe("无模型接续提示（spec: onboarding 无模型状态的接续提示）", () => {
  it("跳过引导且无模型时显示两去向提示；配置模型后消失", async () => {
    await saveSettings(defaultSettings()); // 复位内存兜底存储：无模型、onboarded=false
    const pinia = createPinia();
    setActivePinia(pinia);
    const w = mount(NewReviewPage, { global: { plugins: [pinia] } });
    const settings = useSettingsStore();
    await settings.init();
    await flushPromises();
    const hint = w.find('[data-test="no-model-hint"]');
    expect(hint.exists()).toBe(true);
    expect(hint.text()).toContain("重新运行引导");
    expect(hint.text()).toContain("前往设置");

    await settings.addModel({ provider: "deepseek", model: "deepseek-flash", apiKey: "k" });
    await flushPromises();
    expect(w.find('[data-test="no-model-hint"]').exists()).toBe(false);
    w.unmount();
  });
});
