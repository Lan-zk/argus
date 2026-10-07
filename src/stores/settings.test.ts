// 任务 3.5 单测：同 Provider 复用 Key（spec: settings 同 Provider 复用 Key）
// + 类别分组（spec: settings 类别分组管理：删组回落 / 归属调整 / 新建与复制默认归属）。
import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useSettingsStore } from "./settings";
import { keyring } from "../lib/keyring";
import { loadState } from "../lib/persistence";
import { getRepo, resetRepoForTests } from "../lib/repo";

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

describe("类别分组（spec: settings 类别分组管理）", () => {
  beforeEach(() => {
    resetRepoForTests(); // 分组与类别落库断言需要干净存储（前一用例的组/类别不泄漏）
  });

  it("新建组入列表；allGroups 通用虚拟置顶；重命名与上移/下移同步序", async () => {
    const s = useSettingsStore();
    await s.init();
    await s.addGroup("小说");
    await s.addGroup("讲道稿");
    expect(s.groups.map((g) => g.name)).toEqual(["小说", "讲道稿"]);
    expect(s.allGroups.map((g) => g.name)).toEqual(["通用", "小说", "讲道稿"]);

    await s.renameGroup(s.groups[1].id, "讲道");
    expect(s.allGroups.map((g) => g.name)).toEqual(["通用", "小说", "讲道"]);

    await s.moveGroup(s.groups[1].id, -1); // 讲道上移到小说之前
    expect(s.allGroups.map((g) => g.name)).toEqual(["通用", "讲道", "小说"]);
  });

  it("新建类别默认入通用；复制沿用被复制类别归属", async () => {
    const s = useSettingsStore();
    await s.init();
    const fresh = await s.addCategory({ name: "叙事节奏" });
    expect(fresh.groupId ?? null).toBeNull();

    const g = await s.addGroup("小说");
    await s.assignCategoryGroup(fresh.id, g.id);
    await s.duplicateCategory(fresh.id);
    const copy = s.categories[s.categories.length - 1];
    expect(copy.name).toBe("叙事节奏副本");
    expect(copy.groupId).toBe(g.id); // 沿用归属（spec: 复制类别场景）
  });

  it("调整归属：store 与库同步、读盘往返保留、版本历史不新增", async () => {
    const s = useSettingsStore();
    await s.init();
    const cat = s.categories.find((c) => c.id === "logic")!;
    await s.updateCategory(cat.id, { prompt: `${cat.prompt}\n（修订）` }); // 产生 v2（manual_edit）
    const versionsBefore = (await getRepo().listPromptVersions(cat.id)).length;

    const g = await s.addGroup("小说");
    await s.assignCategoryGroup(cat.id, g.id);
    expect(s.categoryById(cat.id)?.groupId).toBe(g.id);
    // 归属调整不追加提示词版本（分组不触碰 Prompt 版本历史）
    expect((await getRepo().listPromptVersions(cat.id)).length).toBe(versionsBefore);
    // 读盘往返保留归属
    const reloaded = await loadState();
    expect(reloaded.settings.categories.find((c) => c.id === cat.id)?.groupId).toBe(g.id);
  });

  it("删组回落：组内类别保留且移回通用，颜色/启停/默认选中/版本历史不变（spec: 删除分组回落通用）", async () => {
    const s = useSettingsStore();
    await s.init();
    const g = await s.addGroup("小说");
    const logic = s.categories.find((c) => c.id === "logic")!;
    const clarity = s.categories.find((c) => c.id === "clarity")!;
    await s.updateCategory(logic.id, { prompt: `${logic.prompt}\n（修订）` }); // v2
    await s.assignCategoryGroup(logic.id, g.id);
    await s.assignCategoryGroup(clarity.id, g.id);
    const logicBefore = { ...logic };
    const versionsBefore = await getRepo().listPromptVersions(logic.id);

    await s.deleteGroup(g.id);
    expect(s.groups).toHaveLength(0); // 组删除
    expect(s.categories.map((c) => c.id)).toContain(logic.id); // 类别保留
    expect(s.categories.map((c) => c.id)).toContain(clarity.id);
    for (const c of [logic, clarity]) {
      expect(s.categoryById(c.id)?.groupId ?? null).toBeNull(); // 回落通用
    }
    const after = s.categoryById(logic.id)!;
    expect(after.color).toBe(logicBefore.color);
    expect(after.enabled).toBe(logicBefore.enabled);
    expect(after.defaultSelected).toBe(logicBefore.defaultSelected);
    expect(after.prompt).toBe(logicBefore.prompt);
    // 版本历史回归断言：删组前后 appendPromptVersion 记录完全一致
    expect(await getRepo().listPromptVersions(logic.id)).toEqual(versionsBefore);
    // 库侧同步：类别行归属清空、组行不剩
    const stored = await getRepo().listCategories();
    expect(stored.find((c) => c.id === logic.id)?.groupId ?? null).toBeNull();
    expect(await getRepo().listGroups()).toEqual([]);
  });

  it("通用分组不可删：任何入口触发删除都被拒绝且状态不变（spec: 通用分组不可删除）", async () => {
    const s = useSettingsStore();
    await s.init();
    const groupsBefore = [...s.groups];
    await s.deleteGroup(""); // 通用虚拟 id 的空串形态
    await s.deleteGroup(null as unknown as string); // null 形态
    expect(s.groups).toEqual(groupsBefore);
    expect(s.allGroups[0]).toMatchObject({ id: null, name: "通用" });
  });
});
