// spec: app-persistence 保存范围与恢复 + Key 不落明文（sanitize）
import { describe, expect, it, beforeEach } from "vitest";
import {
  clearLastReview,
  defaultSettings,
  loadState,
  saveLastReview,
  saveSettings,
  sanitizeModelConfig,
} from "./persistence";
import { keyring } from "./keyring";
import { parseBlocks } from "../domain/parser";
import type { PersistedReview, ModelConfig, UiPrefs } from "../domain/types";

beforeEach(async () => {
  // 每个用例前清空（开发模式内存兜底存储）
  await clearLastReview();
  await saveSettings(defaultSettings());
});

describe("设置保存范围（spec: 应用状态保存范围）", () => {
  it("模型配置（脱敏）、类别与 Prompt、当前输入文本、UI 偏好全部恢复", async () => {
    const settings = defaultSettings();
    settings.models = [
      { id: "m1", provider: "openai-compatible", model: "glm-4.7", keyringRef: "m1", baseUrl: "https://x/api/v4", isDefault: true },
    ];
    settings.categories[0].prompt = "修改后的逻辑 Prompt。";
    settings.draftText = "当前输入文本草稿";
    settings.ui.splitPercent = 50;
    await saveSettings(settings);

    const loaded = await loadState();
    expect(loaded.settings.models[0].model).toBe("glm-4.7");
    expect(loaded.settings.models[0].keyringRef).toBe("m1");
    expect(loaded.settings.models[0]).not.toHaveProperty("apiKey");
    expect(loaded.settings.categories[0].prompt).toBe("修改后的逻辑 Prompt。");
    expect(loaded.settings.draftText).toBe("当前输入文本草稿");
    expect(loaded.settings.ui.splitPercent).toBe(50);
  });

  it("旧数据缺 theme/appearance 字段时合并默认值 swiss/system（spec: theme-system 偏好持久化与默认值）", async () => {
    const settings = defaultSettings();
    await saveSettings({ ...settings, ui: { splitPercent: 55 } as UiPrefs }); // 模拟旧版本写入的数据
    const loaded = await loadState();
    expect(loaded.settings.ui.splitPercent).toBe(55);
    expect(loaded.settings.ui.theme).toBe("swiss");
    expect(loaded.settings.ui.appearance).toBe("system");
  });

  it("主题偏好保存后恢复", async () => {
    const settings = defaultSettings();
    settings.ui.theme = "apple";
    settings.ui.appearance = "dark";
    await saveSettings(settings);
    const loaded = await loadState();
    expect(loaded.settings.ui.theme).toBe("apple");
    expect(loaded.settings.ui.appearance).toBe("dark");
  });

  it("首次运行种入 7 个默认类别（6 启用 + 1 禁用）", async () => {
    const loaded = await loadState();
    expect(loaded.settings.categories).toHaveLength(7);
    expect(loaded.settings.categories.filter((c) => c.enabled)).toHaveLength(6);
    expect(loaded.settings.categories.find((c) => c.id === "speech")?.enabled).toBe(false);
  });
});

describe("Key 不落明文（spec: API Key 安全存储）", () => {
  it("sanitizeModelConfig 剥离 apiKey 字段", () => {
    const cfg = { id: "m1", provider: "openai", model: "gpt-4o", apiKey: "sk-secret-123", keyringRef: "m1" } as unknown as ModelConfig;
    const stored = sanitizeModelConfig(cfg) as unknown as Record<string, unknown>;
    expect(stored.apiKey).toBeUndefined();
    expect(JSON.stringify(stored)).not.toContain("sk-secret-123");
    expect(stored.keyringRef).toBe("m1");
  });

  it("整个持久化 JSON 序列化不出现 Key 明文", async () => {
    const settings = defaultSettings();
    settings.models = [{ id: "m1", provider: "openai", model: "gpt-4o", apiKey: "sk-topsecret", keyringRef: "m1" }];
    await saveSettings(settings);
    const loaded = await loadState();
    expect(JSON.stringify(loaded)).not.toContain("sk-topsecret");
  });

  it("displayName 持久化往返；trim 后空串等价未设置", async () => {
    const settings = defaultSettings();
    settings.models = [
      { id: "m1", provider: "deepseek", model: "deepseek-flash", displayName: "  公司主力  " },
      { id: "m2", provider: "deepseek", model: "deepseek-v4-pro", displayName: "   " },
    ] as never;
    await saveSettings(settings);
    const loaded = await loadState();
    expect(loaded.settings.models[0].displayName).toBe("公司主力"); // trim
    expect(loaded.settings.models[1].displayName).toBeUndefined(); // 空串归一
  });

  it("keyring 写读往返一致（开发模式内存实现；Tauri 下走钥匙串 command）", async () => {
    await keyring.set("m1", "sk-roundtrip");
    expect(await keyring.get("m1")).toBe("sk-roundtrip");
    await keyring.delete("m1");
    expect(await keyring.get("m1")).toBeNull();
  });
});

describe("onboarding 粘性标记（spec: onboarding 首次运行判定）", () => {
  it("全新数据默认未完成", async () => {
    const loaded = await loadState();
    expect(loaded.settings.ui.onboarded).toBe(false);
  });

  it("旧数据缺 onboarded 但已有模型配置 → 迁移为已完成（老用户升级不触发引导）", async () => {
    const settings = defaultSettings();
    settings.models = [{ id: "m1", provider: "openai", model: "gpt-4o", keyringRef: "m1" }] as ModelConfig[];
    const { onboarded: _drop, ...legacyUi } = defaultSettings().ui; // 模拟旧版本写入的 ui（无该字段）
    void _drop;
    await saveSettings({ ...settings, ui: legacyUi as UiPrefs });
    const loaded = await loadState();
    expect(loaded.settings.ui.onboarded).toBe(true);
  });

  it("已有标记以存值为准（不被迁移覆盖）", async () => {
    const settings = defaultSettings();
    settings.models = [{ id: "m1", provider: "openai", model: "gpt-4o", keyringRef: "m1" }] as ModelConfig[];
    settings.ui.onboarded = false; // 显式 false + 有模型：以存值为准
    await saveSettings(settings);
    expect((await loadState()).settings.ui.onboarded).toBe(false);
    settings.ui.onboarded = true;
    await saveSettings(settings);
    expect((await loadState()).settings.ui.onboarded).toBe(true);
  });
});

describe("最近一次 Review 的保存与恢复（spec: 恢复最近一次 Review）", () => {
  it("保存后可完整恢复 session/runs/findings/report；清除后为空", async () => {
    const review: PersistedReview = {
      session: {
        id: "sess_1",
        documentId: "doc_1",
        selectedCategoryIds: ["logic"],
        status: "completed",
        createdAt: new Date().toISOString(),
      },
      document: { id: "doc_1", text: "# t\n\n正文", blocks: parseBlocks("# t\n\n正文"), createdAt: new Date().toISOString() },
      runs: [
        { id: "r1", reviewSessionId: "sess_1", categoryId: "logic", status: "completed", modelConfigId: "m1" },
      ],
      findings: [
        {
          id: "f1",
          categoryId: "logic",
          severity: "high",
          title: "推理跳跃",
          quote: "正文",
          problem: "p",
          reason: "r",
          suggestion: "s",
          anchorStatus: "unanchored",
          anchors: [],
        },
      ],
      report: {
        summary: "s",
        priorityFindingIds: ["f1"],
        categorySummaries: [{ categoryId: "logic", high: 1, medium: 0, low: 0, summary: "x" }],
        failedCategoryIds: [],
        generatedAt: new Date().toISOString(),
      },
    };
    await saveLastReview(review);
    const loaded = await loadState();
    expect(loaded.lastReview?.session.id).toBe("sess_1");
    expect(loaded.lastReview?.findings).toHaveLength(1);
    expect(loaded.lastReview?.report?.priorityFindingIds).toEqual(["f1"]);
    expect(loaded.lastReview?.document.blocks).toHaveLength(2);

    await clearLastReview();
    const cleared = await loadState();
    expect(cleared.lastReview).toBeNull();
  });
});
