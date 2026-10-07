// 旧数据首迁测试（tasks 1.6）+ fixture 迁移矩阵（tasks 1.7）：
// 成功路径、失败重试（幂等重放）、重复迁移不重复、onboarding 老数据启发式。
// fixture 矩阵：fixtures/ 下每个 golden 文件（各历史版本脱敏样本）跑「迁移到最新」并断言不变量——
// 新增 schema 版本时 MUST 追加对应 fixture（工程纪律，见 openspec/config.yaml operations guidance）。

import { beforeEach, describe, expect, it } from "vitest";
import { MemoryRepo } from "../memory";
import type { Repo } from "../types";
import { migrateLegacyStore, type LegacyStoreJson } from "./legacy";

const fixtureJsons = import.meta.glob<LegacyStoreJson>("./fixtures/*.json", {
  eager: true,
  import: "default",
});
const fixtureNames = Object.keys(fixtureJsons);
const fixture = (name: string): LegacyStoreJson => fixtureJsons[`./fixtures/${name}`] ?? fixtureJsons[name];

/** 对任意版本 fixture 迁移后的不变量断言（矩阵核心）。 */
async function assertMigrationInvariants(repo: Repo, legacy: LegacyStoreJson): Promise<void> {
  const marker = await repo.getPref<boolean>("legacyMigrated");
  expect(marker).toBe(true);
  // 设置区：模型与类别全量迁入，Key 明文不出现
  const models = await repo.listModels();
  expect(models.length).toBe(legacy.settings?.models?.length ?? 0);
  expect(JSON.stringify(models)).not.toContain("apiKey");
  const categories = await repo.listCategories();
  expect(categories.length).toBeGreaterThan(0);
  for (const c of categories) {
    const versions = await repo.listPromptVersions(c.id);
    expect(versions.length).toBeGreaterThanOrEqual(1);
    expect(versions[0].source).toBe("builtin");
    // 旧格式无分组概念：全部回落「通用」（spec: settings 类别分组管理，group_id 可空列）
    expect(c.groupId ?? null).toBeNull();
  }
  // 旧格式无自定义分组：组表可读且为空
  expect(await repo.listGroups()).toEqual([]);
  // lastReview → 「导入的审阅」Round 1
  if (legacy.lastReview?.session) {
    const projects = await repo.listProjects();
    expect(projects.map((p) => p.name)).toContain("导入的审阅");
    const snap = await repo.loadRound(`round_legacy_${legacy.lastReview.session.id}`);
    expect(snap).not.toBeNull();
    expect(snap!.round.number).toBe(1);
    expect(snap!.findings.length).toBe(legacy.lastReview.findings?.length ?? 0);
  }
}

describe("首迁成功路径（fixture: legacy-store.v0.json）", () => {
  let repo: MemoryRepo;
  beforeEach(() => {
    repo = new MemoryRepo();
  });

  it("设置区迁入：模型（displayName trim）、类别（种 v1 builtin）、偏好（含 onboarding 启发式）", async () => {
    const legacy = fixture("legacy-store.v0.json");
    await migrateLegacyStore(repo, legacy);
    const models = await repo.listModels();
    expect(models.find((m) => m.id === "m_k9p2")?.displayName).toBe("DeepSeek 备用");
    expect(models.find((m) => m.id === "m_g28x")?.contextWindow).toBe(128000);
    const ui = await repo.getPref<{ splitPercent: number; theme: string; appearance: string; onboarded: boolean }>("ui");
    expect(ui).toMatchObject({ splitPercent: 55, theme: "swiss", appearance: "dark" });
    // fixture 的 ui 缺 onboarded 但已有模型 → 启发式判定为已初始化（老用户不被重新弹引导）
    expect(ui?.onboarded).toBe(true);
    expect(await repo.getPref<string>("draftText")).toBe("旧版本遗留的输入草稿");
  });

  it("lastReview → 「导入的审阅」项目 Round 1（含 blockSeq 映射与报告）", async () => {
    const legacy = fixture("legacy-store.v0.json");
    await migrateLegacyStore(repo, legacy);
    const snap = await repo.loadRound("round_legacy_sess_1");
    expect(snap).not.toBeNull();
    expect(snap!.round.status).toBe("partial_failed");
    expect(snap!.round.categorySnapshot).toEqual([
      { categoryId: "logic", version: 1 },
      { categoryId: "clarity", version: 1 },
    ]);
    expect(snap!.round.modelSnapshot).toEqual({ logic: "m_g28x", clarity: "m_g28x" });
    expect(snap!.document.sourceMeta).toEqual({ kind: "paste" });
    expect(snap!.blocks).toHaveLength(2);
    expect(snap!.runs).toHaveLength(2);
    expect(snap!.runs.find((r) => r.id === "run_clarity")?.error).toBe("网络中断");
    const f1 = snap!.findings.find((f) => f.id === "find_1");
    expect(f1?.blockSeq).toBe(1); // block_002 → seq 1
    expect(f1?.line).toBe(3);
    expect(snap!.report?.failedCategoryIds).toEqual(["clarity"]);
  });

  it("幂等重放：同一 fixture 迁移两次，数据不重复", async () => {
    const legacy = fixture("legacy-store.v0.json");
    await migrateLegacyStore(repo, legacy);
    await migrateLegacyStore(repo, legacy);
    expect(await repo.listProjects()).toHaveLength(1);
    const snap = await repo.loadRound("round_legacy_sess_1");
    expect(snap!.findings).toHaveLength(2);
    expect(snap!.blocks).toHaveLength(2);
    expect((await repo.listPromptVersions("logic")).length).toBe(1);
  });
});

describe("失败重试（spec: 迁移失败可重试）", () => {
  it("中途失败不写完成标记；重放成功后数据完整且标记置位", async () => {
    const legacy = fixture("legacy-store.v0.json");
    const inner = new MemoryRepo();
    // 首次：putReport 时注入失败（模拟迁移中途崩溃）
    let failedOnce = false;
    const failing: Repo = new Proxy(inner, {
      get(target, prop, receiver) {
        if (prop === "putReport" && !failedOnce) {
          failedOnce = true;
          return async () => {
            throw new Error("simulated crash mid-migration");
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    });
    await expect(migrateLegacyStore(failing, legacy)).rejects.toThrow("simulated crash mid-migration");
    expect(await inner.getPref("legacyMigrated")).toBeUndefined(); // 无完成标记 → 下次启动重试

    // 二次：无注入，同库重放成功
    await migrateLegacyStore(inner, legacy);
    await assertMigrationInvariants(inner, legacy);
  });
});

describe("fixture 迁移矩阵（tasks 1.7，CI 全量跑）", () => {
  it("fixtures 目录非空（新 schema 版本 MUST 追加 golden fixture）", () => {
    expect(fixtureNames.length).toBeGreaterThanOrEqual(1);
  });

  for (const path of fixtureNames) {
    const name = path.replace("./fixtures/", "");
    it(`${name} → 迁移到最新，不变量成立`, async () => {
      const repo = new MemoryRepo();
      const legacy = fixture(name);
      await migrateLegacyStore(repo, legacy);
      await assertMigrationInvariants(repo, legacy);
    });
  }
});
