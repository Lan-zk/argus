// 开始审阅交互（spec: review-ui 加载反馈可达性 + 双开守卫 + 早失败可见）
// + 文件导入（spec: document-import 入口/排除指引/预览确认/长文策略 + review-ui 30k 收窄 delta）
// + 组切换器（spec: review-ui 类别选择：分节 / 空组置灰 / 切组替换勾选 / 跨组加勾 / 恢复默认不动视图）。
import { describe, expect, it, vi, beforeEach } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import NewReviewPage from "./NewReviewPage.vue";
import { useSettingsStore } from "../stores/settings";
import { useSessionStore } from "../stores/session";
import { useUiStore } from "../stores/ui";
import { keyring } from "../lib/keyring";
import { defaultSettings, saveSettings } from "../lib/persistence";
import { importDocument } from "../lib/importers";
import { resetRepoForTests } from "../lib/repo";

vi.mock("../lib/importers", () => ({ importDocument: vi.fn() }));

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
    expect(ui.reviewView).toBe("workspace");
    resolve();
    await pending;
    w.unmount();
  });

  it("审阅进行中：开始按钮禁用并提示前往工作台（双开守卫）", async () => {
    const { w } = await mountReady();
    const session = useSessionStore();
    const ui = useUiStore();
    ui.goReview("new"); // 从列表下钻进入输入视图
    session.session = {
      id: "s1", documentId: "d", selectedCategoryIds: ["logic"], status: "running", createdAt: new Date().toISOString(),
    };
    await flushPromises();
    const btn = w.find("button.primary");
    expect(btn.attributes("disabled")).toBeDefined();
    expect(btn.text()).toContain("审阅进行中");
    expect(w.text()).toContain("审阅工作台");
    expect(ui.reviewView).toBe("new");
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
    expect(ui.reviewView).toBe("new");
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

describe("文件导入入口（spec: document-import 支持格式与排除项）", () => {
  it("导入入口存在且触发导入流程", async () => {
    const { w } = await mountReady();
    const entry = w.find('[data-test="import-entry"]');
    expect(entry.exists()).toBe(true);
    expect(entry.text()).toContain("导入文件");
    vi.mocked(importDocument).mockResolvedValue(null); // 模拟用户取消选择框
    await entry.trigger("click");
    await flushPromises();
    expect(importDocument).toHaveBeenCalled();
    expect(w.find('[data-test="import-preview"]').exists()).toBe(false); // 取消不出现预览
    w.unmount();
  });

  it("旧版 .doc：显示「另存为 .docx」指引且不进入解析预览", async () => {
    const { w } = await mountReady();
    vi.mocked(importDocument).mockRejectedValue(
      new Error("旧版 .doc 格式不支持直接导入：请先在 Word 中打开该文件，另存为 .docx 后再导入。"),
    );
    await w.find('[data-test="import-entry"]').trigger("click");
    await flushPromises();
    const errbox = w.find('[data-test="import-error"]');
    expect(errbox.exists()).toBe(true);
    expect(errbox.text()).toContain("另存为 .docx");
    expect(w.find('[data-test="import-preview"]').exists()).toBe(false);
    w.unmount();
  });
});

describe("导入预览确认与长文策略（spec: document-import 预览确认 / 导入长文策略）", () => {
  it("预览 → 确认 → 写入输入区等价粘贴，来源随开始审阅传给 session", async () => {
    const { w, settings } = await mountReady();
    const session = useSessionStore();
    vi.mocked(importDocument).mockResolvedValue({
      kind: "docx",
      filename: "季度报告.docx",
      text: "# 季度报告\n\n导入的正文内容。",
      importedAt: "2026-10-05T12:00:00.000Z",
    });
    await w.find('[data-test="import-entry"]').trigger("click");
    await flushPromises();
    expect(w.find('[data-test="import-preview"]').exists()).toBe(true);
    await w.find('[data-test="import-confirm"]').trigger("click");
    await flushPromises();
    expect(settings.draftText).toBe("# 季度报告\n\n导入的正文内容。");
    expect(w.find('[data-test="import-preview"]').exists()).toBe(false); // 预览层关闭

    // 开始审阅时来源落库为 docx 导入
    vi.spyOn(session, "startReview").mockResolvedValue(undefined);
    await w.find("button.primary").trigger("click");
    await flushPromises();
    const call = vi.mocked(session.startReview).mock.calls[0];
    expect(call?.[2]?.sourceMeta).toEqual({
      kind: "docx",
      filename: "季度报告.docx",
      importedAt: "2026-10-05T12:00:00.000Z",
    });
    w.unmount();
  });

  it("预览中手动修正 → 确认进入的是修正后文本（spec: 预览中手动修正）", async () => {
    const { w, settings } = await mountReady();
    vi.mocked(importDocument).mockResolvedValue({
      kind: "pdf",
      filename: "手稿.pdf",
      text: "提取混乱的表格文本",
      importedAt: "2026-10-05T12:00:00.000Z",
    });
    await w.find('[data-test="import-entry"]').trigger("click");
    await flushPromises();
    await w.find('[data-test="import-preview-text"]').setValue("手动整理后的文本");
    await w.find('[data-test="import-confirm"]').trigger("click");
    await flushPromises();
    expect(settings.draftText).toBe("手动整理后的文本");
    w.unmount();
  });

  it("取消导入：草稿不变、无预览残留（spec: 取消不产生数据）", async () => {
    const { w, settings } = await mountReady();
    const before = settings.draftText;
    vi.mocked(importDocument).mockResolvedValue({
      kind: "txt",
      filename: "笔记.txt",
      text: "被取消的导入内容",
      importedAt: "2026-10-05T12:00:00.000Z",
    });
    await w.find('[data-test="import-entry"]').trigger("click");
    await flushPromises();
    await w.find('[data-test="import-cancel"]').trigger("click");
    await flushPromises();
    expect(settings.draftText).toBe(before);
    expect(w.find('[data-test="import-preview"]').exists()).toBe(false);
    w.unmount();
  });

  it("80k 导入全量进入（绕过 30k 截断）并显示长文降级提示（tasks 4.2）", async () => {
    const { w, settings } = await mountReady();
    const long = "长".repeat(80_000);
    vi.mocked(importDocument).mockResolvedValue({
      kind: "docx",
      filename: "超长.docx",
      text: long,
      importedAt: "2026-10-05T12:00:00.000Z",
    });
    await w.find('[data-test="import-entry"]').trigger("click");
    await flushPromises();
    // 预览层超限警告
    expect(w.find('[data-test="import-overlimit-warn"]').exists()).toBe(true);
    await w.find('[data-test="import-confirm"]').trigger("click");
    await flushPromises();
    // 全量写入，不截断（spec: 导入长文策略——不受粘贴上限阻止）
    expect(settings.draftText.length).toBe(80_000);
    // 输入区显示导入长文提示（而非「已达上限」阻止语义）
    const note = w.find('[data-test="imported-over-note"]');
    expect(note.exists()).toBe(true);
    expect(note.text()).toContain("长文结构化降级");
    // 导入长文之上手动修正不截断（收窄语义：截断仅粘贴/手动输入路径）
    await w.find("textarea.doc-input").setValue("字".repeat(90_000));
    expect(settings.draftText.length).toBe(90_000);
    w.unmount();
  });
});

describe("粘贴路径 30k 上限回归（spec: review-ui 原文输入与长度上限 delta）", () => {
  it("粘贴超长仍被阻止在 30 000（导入收窄不影响既有行为）", async () => {
    const { w, settings } = await mountReady();
    await w.find("textarea.doc-input").setValue("x".repeat(40_000));
    expect(settings.draftText.length).toBe(30_000);
    expect(w.find('[data-test="imported-over-note"]').exists()).toBe(false);
    expect(w.text()).toContain("已达上限");
    w.unmount();
  });

  it("粘贴替换导入稿（开头不同）→ 导入来源失效，恢复粘贴截断", async () => {
    const { w, settings } = await mountReady();
    const session = useSessionStore();
    vi.mocked(importDocument).mockResolvedValue({
      kind: "txt",
      filename: "导入稿.txt",
      text: "导入稿开头。后续内容。",
      importedAt: "2026-10-05T12:00:00.000Z",
    });
    await w.find('[data-test="import-entry"]').trigger("click");
    await flushPromises();
    await w.find('[data-test="import-confirm"]').trigger("click");
    await flushPromises();
    // 整段粘贴替换（开头完全不同）→ 来源失效
    await w.find("textarea.doc-input").setValue("y".repeat(40_000));
    expect(settings.draftText.length).toBe(30_000);
    vi.spyOn(session, "startReview").mockResolvedValue(undefined);
    await w.find("button.primary").trigger("click");
    await flushPromises();
    const call = vi.mocked(session.startReview).mock.calls[0];
    expect(call?.[2]?.sourceMeta).toEqual({ kind: "paste" });
    w.unmount();
  });
});

describe("组切换器（spec: review-ui 类别选择）", () => {
  beforeEach(() => {
    resetRepoForTests(); // 干净存储：默认类别重新种子、组不跨用例泄漏
  });

  /** 挂载 + 初始化 + 建组：小说（logic 归入）、讲道稿（仅默认禁用的 speech 归入 → 空组）。 */
  async function mountWithGroups() {
    const pinia = createPinia();
    setActivePinia(pinia);
    const w = mount(NewReviewPage, { global: { plugins: [pinia] } });
    const settings = useSettingsStore();
    await settings.init();
    await settings.addModel({ provider: "deepseek", model: "deepseek-flash", apiKey: "k" });
    const novel = await settings.addGroup("小说");
    const sermon = await settings.addGroup("讲道稿");
    await settings.assignCategoryGroup("logic", novel.id);
    await settings.assignCategoryGroup("speech", sermon.id); // speech 默认禁用 → 讲道稿为空组
    await flushPromises();
    return { w, settings, novel, sermon };
  }

  it("无自定义组时切换器不显示（行为等同「全部」视图）", async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const w = mount(NewReviewPage, { global: { plugins: [pinia] } });
    const settings = useSettingsStore();
    await settings.init();
    await flushPromises();
    expect(w.find('[data-test="group-switcher"]').exists()).toBe(false);
    w.unmount();
  });

  it("切换器按序渲染 全部/通用/自定义组；无启用类别的分组置灰不可选（spec: 空分组置灰）", async () => {
    const { w, sermon } = await mountWithGroups();
    const tabs = w.findAll("[data-test^='group-tab-']");
    expect(tabs.map((t) => t.text())).toEqual(["全部", "通用", "小说", "讲道稿"]);
    const sermonTab = w.find(`[data-test="group-tab-g:${sermon.id}"]`);
    expect(sermonTab.attributes("disabled")).toBeDefined();
    await sermonTab.trigger("click"); // 置灰点击无效果
    expect(sermonTab.classes()).not.toContain("on");
    expect(w.findAll("[data-test^='cat-section-']").length).toBeGreaterThan(0); // 仍在全部视图
    w.unmount();
  });

  it("「全部」视图按组分节（通用置顶），defaultSelected 预选不变", async () => {
    const { w } = await mountWithGroups();
    const sections = w.findAll("[data-test^='cat-section-']");
    expect(sections.map((s) => s.text())).toEqual(["通用", "小说"]); // 讲道稿空节隐藏
    // logic（小说节内）默认选中为勾选；speech 禁用不出现
    const labels = w.findAll(".catrow");
    const logicRow = labels.find((r) => r.text().includes("逻辑"))!;
    expect((logicRow.find("input[type='checkbox']").element as HTMLInputElement).checked).toBe(true);
    expect(labels.some((r) => r.text().includes("演讲表达"))).toBe(false);
    w.unmount();
  });

  it("切组替换勾选：点「小说」= 勾选集替换为小说组 enabled 全集，此前勾选清除（spec: 切组替换勾选）", async () => {
    const { w, settings } = await mountWithGroups();
    // 初始 = 默认选中（6 个内置启用类别全勾）
    expect(w.findAll(".catrow input[type='checkbox']:checked").length).toBe(6);
    await w.find("[data-test='group-tab-g:general']").trigger("click"); // 先切通用：勾选替换为通用 5 类
    await flushPromises();
    expect(w.findAll(".catrow input[type='checkbox']:checked").length).toBe(5);
    // 切小说：勾选整体替换为小说组全集（仅 logic）
    const novelTab = w.findAll("[data-test^='group-tab-']").find((t) => t.text() === "小说")!;
    await novelTab.trigger("click");
    await flushPromises();
    const rows = w.findAll(".catrow");
    expect(rows.length).toBe(1); // 小说视图仅显示该组
    expect(rows[0].text()).toContain("逻辑");
    expect((rows[0].find("input").element as HTMLInputElement).checked).toBe(true);
    // 通用类别（如清晰度）不再勾选
    expect(settings.defaultSelectedIds).toContain("clarity");
    const checkedCount = w.findAll(".catrow input[type='checkbox']:checked").length;
    expect(checkedCount).toBe(1);
    w.unmount();
  });

  it("跨组自由加勾：小说视图替换后回「全部」，可再勾通用类别参与同一次审阅（spec: 跨组自由加勾）", async () => {
    const { w } = await mountWithGroups();
    const novelTab = w.findAll("[data-test^='group-tab-']").find((t) => t.text() === "小说")!;
    await novelTab.trigger("click");
    await flushPromises();
    await w.find("[data-test='group-tab-all']").trigger("click"); // 回全部视图，勾选保持小说全集
    await flushPromises();
    const clarityRow = w.findAll(".catrow").find((r) => r.text().includes("清晰度"))!;
    await clarityRow.find("input[type='checkbox']").trigger("change"); // 跨组加勾
    await flushPromises();
    expect((clarityRow.find("input[type='checkbox']").element as HTMLInputElement).checked).toBe(true); // 未被组边界阻止
    const logicRow = w.findAll(".catrow").find((r) => r.text().includes("逻辑"))!;
    expect((logicRow.find("input[type='checkbox']").element as HTMLInputElement).checked).toBe(true); // 小说勾选保留
    w.unmount();
  });

  it("恢复默认仅重置勾选，MUST NOT 改变当前视图（spec: 恢复默认不影响视图）", async () => {
    const { w } = await mountWithGroups();
    const novelTab = w.findAll("[data-test^='group-tab-']").find((t) => t.text() === "小说")!;
    await novelTab.trigger("click");
    await flushPromises();
    expect(novelTab.classes()).toContain("on");
    const resetBtn = w.findAll("button.mini").find((b) => b.text() === "恢复默认")!;
    await resetBtn.trigger("click");
    await flushPromises();
    // 视图仍停留在小说分组
    expect(w.findAll(".catrow").length).toBe(1);
    expect(w.find(`[data-test^='cat-section-']`).exists()).toBe(false); // 分节标题仅在全部视图渲染
    // 勾选已重置为默认选中集合（全局 6 类；视图内 logic 为勾选）
    const logicRow = w.findAll(".catrow")[0];
    expect((logicRow.find("input").element as HTMLInputElement).checked).toBe(true);
    w.unmount();
  });
});
