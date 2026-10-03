// 任务 3.5 单测：同 Provider 复用 Key（spec: settings 同 Provider 复用 Key）。
import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useSettingsStore } from "./settings";
import { keyring } from "../lib/keyring";
import { loadState } from "../lib/persistence";

beforeEach(() => {
  setActivePinia(createPinia());
});

describe("onboarding 粘性标记（spec: onboarding 首次运行判定）", () => {
  it("setOnboarded 置位并持久化（落盘数据可见）", async () => {
    const s = useSettingsStore();
    await s.init();
    expect(s.ui.onboarded).toBe(false);
    await s.setOnboarded(true);
    expect(s.ui.onboarded).toBe(true);
    expect((await loadState()).settings.ui.onboarded).toBe(true);
  });
});

describe("同 Provider 复用 Key", () => {
  it("第二个同预设模型免填 Key：钥匙串自动复制到新配置条目", async () => {
    const s = useSettingsStore();
    const first = await s.addModel({ provider: "deepseek", model: "deepseek-flash", apiKey: "sk-first" });
    const second = await s.addModel({ provider: "deepseek", model: "deepseek-v4-pro" }); // 无 Key
    expect(second.keyringRef).toBe(second.id);
    expect(await keyring.get(second.id)).toBe("sk-first"); // 复制成功
    expect(await s.getApiKey(second)).toBe("sk-first");
    void first;
  });

  it("reusableKey 命中预设 Provider；删除旧配置后不复用", async () => {
    const s = useSettingsStore();
    expect(await s.reusableKey("deepseek")).toBeNull();
    const m = await s.addModel({ provider: "deepseek", model: "deepseek-flash", apiKey: "sk-x" });
    expect(await s.reusableKey("deepseek")).toBe("sk-x");
    await s.deleteModel(m.id);
    expect(await s.reusableKey("deepseek")).toBeNull();
  });

  it("自定义家族不跨端点复用（不同 BaseURL 是不同服务，防 Key 外泄）", async () => {
    const s = useSettingsStore();
    await s.addModel({
      provider: "openai-compatible",
      model: "m1",
      apiKey: "sk-endpoint-a",
      baseUrl: "https://a.example/v1",
    });
    expect(await s.reusableKey("openai-compatible")).toBeNull(); // 不复用
    const b = await s.addModel({
      provider: "openai-compatible",
      model: "m2",
      baseUrl: "https://b.example/v1",
    });
    expect(await keyring.get(b.id)).toBeNull(); // 未自动带入 A 的 Key
  });

  it("displayName 经 addModel/updateModel 透传且改名不影响其他字段", async () => {
    const s = useSettingsStore();
    const m = await s.addModel({
      provider: "deepseek",
      model: "deepseek-flash",
      apiKey: "sk-dn",
      displayName: "快速通道",
    });
    expect(s.models[0].displayName).toBe("快速通道");
    await s.updateModel(m.id, { displayName: "改名后" });
    expect(s.models[0].displayName).toBe("改名后");
    expect(s.models[0].model).toBe("deepseek-flash"); // 其他字段不动
    expect(s.models[0].provider).toBe("deepseek");
  });

  it("getApiKey 回退链：本配置条目缺失时走同 Provider 兄弟条目", async () => {
    const s = useSettingsStore();
    const a = await s.addModel({ provider: "zai", model: "glm-5.3", apiKey: "sk-zai" });
    const b = await s.addModel({ provider: "zai", model: "glm-5.3-flash", apiKey: "sk-zai-2" });
    // 模拟重启恢复后的形态：内存无 Key、本条目丢失 → 应回退到兄弟条目 a
    await keyring.delete(b.id);
    const restored = { ...b, apiKey: undefined };
    expect(await s.getApiKey(restored)).toBe("sk-zai");
    expect(await s.getApiKey(a)).toBe("sk-zai");
  });
});

describe("主题偏好（spec: theme-system 偏好持久化与默认值）", () => {
  it("默认 swiss + system", () => {
    const s = useSettingsStore();
    expect(s.ui.theme).toBe("swiss");
    expect(s.ui.appearance).toBe("system");
  });

  it("setTheme/setAppearance 更新 ui 并落盘，重启恢复", async () => {
    const s = useSettingsStore();
    await s.setTheme("apple");
    await s.setAppearance("dark");
    expect(s.ui.theme).toBe("apple");
    expect(s.ui.appearance).toBe("dark");
    const loaded = await loadState();
    expect(loaded.settings.ui.theme).toBe("apple");
    expect(loaded.settings.ui.appearance).toBe("dark");
  });

  it("init 幂等：已 loaded 后再调用不覆盖内存状态", async () => {
    const s = useSettingsStore();
    await s.init();
    s.ui.appearance = "dark"; // 仅改内存、不落盘
    await s.init(); // 已 loaded，直接返回；若重复读盘会把内存值冲掉
    expect(s.ui.appearance).toBe("dark");
  });
});

describe("类别颜色（spec: settings 类别颜色配置 / category-colors）", () => {
  it("连续新建未指定颜色的类别获得轮转调色板色，互相可区分", async () => {
    const s = useSettingsStore();
    const a = await s.addCategory({ name: "自定义一" });
    const b = await s.addCategory({ name: "自定义二" });
    expect(a.color).toMatch(/^var\(--p\d+\)$/);
    expect(b.color).toMatch(/^var\(--p\d+\)$/);
    expect(a.color).not.toBe(b.color);
  });

  it("显式指定颜色时不轮转", async () => {
    const s = useSettingsStore();
    const c = await s.addCategory({ name: "指定色", color: "#123456" });
    expect(c.color).toBe("#123456");
  });
});
