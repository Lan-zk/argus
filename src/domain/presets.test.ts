// 任务 1.1 快照单测：预设清单与 pi-ai 静态目录对照（清单漂移早发现）。
import { describe, expect, it } from "vitest";
import { GROUP_ZH, MODEL_PRESETS, PRESET_IDS, presetById, displayProviderName } from "./presets";
import { getPresetProvider } from "../ai/client";

describe("预设清单完整性", () => {
  it("共 29 项（国内 15 / 国际 12 / 聚合 2），id 唯一", () => {
    expect(MODEL_PRESETS).toHaveLength(29);
    expect(MODEL_PRESETS.filter((p) => p.group === "cn")).toHaveLength(15);
    expect(MODEL_PRESETS.filter((p) => p.group === "global")).toHaveLength(12);
    expect(MODEL_PRESETS.filter((p) => p.group === "aggregator")).toHaveLength(2);
    expect(new Set(PRESET_IDS).size).toBe(PRESET_IDS.length);
  });

  it("分组标签齐备", () => {
    expect(GROUP_ZH.cn).toBe("国内服务");
    expect(GROUP_ZH.global).toBe("国际服务");
    expect(GROUP_ZH.aggregator).toBe("聚合平台");
  });
});

describe("预设与 pi-ai 目录对照（快照）", () => {
  it("每个预设 id 都能注册 pi-ai Provider 工厂", async () => {
    for (const id of PRESET_IDS) {
      const p = await getPresetProvider(id);
      expect(p, `预设 ${id} 无对应 pi-ai 工厂`).not.toBeNull();
    }
  });

  it("推荐默认模型必须存在于该 Provider 静态目录", async () => {
    for (const preset of MODEL_PRESETS) {
      const provider = await getPresetProvider(preset.id);
      const ids = provider!.getModels().map((m) => m.id);
      expect(
        ids,
        `预设 ${preset.id} 推荐模型 ${preset.recommendedModel} 不在目录 [${ids.slice(0, 5).join(", ")}…]`,
      ).toContain(preset.recommendedModel);
    }
  });

  it("预设 Provider 均有固定 baseUrl（动态网关不得入选）", async () => {
    for (const id of PRESET_IDS) {
      const p = await getPresetProvider(id);
      expect(p!.baseUrl, `预设 ${id} 缺少固定 baseUrl`).toBeTruthy();
    }
  });
});

describe("展示名", () => {
  it("预设显示名含变体标注；未知 id 回退家族名", () => {
    expect(displayProviderName("deepseek")).toBe("DeepSeek");
    expect(displayProviderName("moonshotai-cn")).toBe("Kimi（国内端点）");
    expect(displayProviderName("whatever", "OpenAI-compatible")).toBe("OpenAI-compatible");
    expect(presetById("deepseek")?.recommendedModel).toBe("deepseek-flash");
  });
});
