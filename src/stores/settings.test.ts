// 任务 3.5 单测：同 Provider 复用 Key（spec: settings 同 Provider 复用 Key）。
import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useSettingsStore } from "./settings";
import { keyring } from "../lib/keyring";

beforeEach(() => {
  setActivePinia(createPinia());
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
