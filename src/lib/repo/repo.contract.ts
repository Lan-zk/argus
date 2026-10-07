// Repo 契约测试套件（tasks 1.2/1.4）：同一套断言跑内存实现与 SQLite 实现
// （SQLite 经 node:sqlite 适配真实引擎；Tauri 运行时下与 plugin-sql 同一 SQL 路径）。
// 另含 API 面断言：findings/documents/reports 的禁改写方法永不存在（不可变轮次约束）。

import { describe, expect, it } from "vitest";
import type { Repo } from "./types";
import { FORBIDDEN_REPO_METHODS } from "./types";

const NOW = "2026-10-04T10:00:00.000Z";

export function runRepoContractSuite(make: () => Promise<Repo> | Repo): void {
  /** 每个用例独立开新库（内存为空操作；sqlite 建表迁移） */
  async function fresh(): Promise<Repo> {
    const repo = await make();
    await repo.open();
    return repo;
  }
  describe("settings 区契约", () => {
    it("models upsert / 删除 / 往返；行内永不出现 apiKey 字段", async () => {
      const repo = await fresh();
      await repo.putModel({ id: "m1", provider: "zhipu", model: "glm-4.7", keyringRef: "m1", isDefault: true, contextWindow: 128000 });
      await repo.putModel({ id: "m2", provider: "deepseek", model: "deepseek-v3", displayName: "备用" });
      let models = await repo.listModels();
      expect(models).toHaveLength(2);
      expect(models.find((m) => m.id === "m1")?.contextWindow).toBe(128000);
      expect(models.find((m) => m.id === "m2")?.displayName).toBe("备用");
      expect(JSON.stringify(models)).not.toContain("apiKey");
      await repo.deleteModel("m2");
      models = await repo.listModels();
      expect(models).toHaveLength(1);
      expect(models[0].id).toBe("m1");
    });

    it("putCategory 首次落库自动种 v1（builtin）；appendPromptVersion 追加并前移 currentVersion；版本历史只增", async () => {
      const repo = await fresh();
      await repo.putCategory({ id: "logic", name: "逻辑", prompt: "p-v1", enabled: true, defaultSelected: true, order: 0, currentVersion: 1 });
      let versions = await repo.listPromptVersions("logic");
      expect(versions).toHaveLength(1);
      expect(versions[0]).toMatchObject({ version: 1, source: "builtin", prompt: "p-v1" });
      expect(await repo.getPromptVersionText("logic", 1)).toBe("p-v1");

      const v2 = await repo.appendPromptVersion("logic", "manual_edit", "p-v2");
      const v3 = await repo.appendPromptVersion("logic", "skill_import", "p-v3", { zip: "x.zip" });
      expect(v2).toBe(2);
      expect(v3).toBe(3);
      versions = await repo.listPromptVersions("logic");
      expect(versions.map((v) => v.version)).toEqual([1, 2, 3]);
      expect(versions[2].skillMeta).toEqual({ zip: "x.zip" });
      // 类别行 currentVersion 前移
      const cats = await repo.listCategories();
      expect(cats.find((c) => c.id === "logic")?.currentVersion).toBe(3);
      // 旧版本文本不可变
      expect(await repo.getPromptVersionText("logic", 1)).toBe("p-v1");
    });

    it("prefs JSON 往返与删除", async () => {
      const repo = await fresh();
      await repo.setPref("ui", { splitPercent: 55, theme: "apple" });
      expect(await repo.getPref<{ splitPercent: number; theme: string }>("ui")).toEqual({ splitPercent: 55, theme: "apple" });
      await repo.setPref("flag", true);
      expect(await repo.getPref<boolean>("flag")).toBe(true);
      await repo.deletePref("ui");
      expect(await repo.getPref("ui")).toBeUndefined();
    });
  });

  describe("分组区契约（spec: settings 类别分组管理）", () => {
    it("组 CRUD：插入幂等、按序读回、重命名、上移/下移交换、删除不剩行", async () => {
      const repo = await fresh();
      await repo.insertGroup({ id: "g_novel", name: "小说", order: 0 });
      await repo.insertGroup({ id: "g_sermon", name: "讲道稿", order: 1 });
      await repo.insertGroup({ id: "g_novel", name: "小说", order: 0 }); // 重放不重复
      expect(await repo.listGroups()).toEqual([
        { id: "g_novel", name: "小说", order: 0 },
        { id: "g_sermon", name: "讲道稿", order: 1 },
      ]);
      await repo.renameGroup("g_sermon", "讲道");
      expect((await repo.listGroups())[1]).toMatchObject({ id: "g_sermon", name: "讲道" });
      await repo.moveGroup("g_sermon", -1); // 上移到首位
      expect((await repo.listGroups()).map((g) => g.id)).toEqual(["g_sermon", "g_novel"]);
      await repo.moveGroup("g_sermon", -1); // 已在首位：无效果
      expect((await repo.listGroups()).map((g) => g.id)).toEqual(["g_sermon", "g_novel"]);
      await repo.deleteGroup("g_sermon");
      expect((await repo.listGroups()).map((g) => g.id)).toEqual(["g_novel"]);
      await repo.deleteGroup("g_sermon"); // 幂等
      expect(await repo.listGroups()).toHaveLength(1);
    });

    it("类别归属读写：putCategory 带 group_id、assignCategoryGroup 调整、null=通用", async () => {
      const repo = await fresh();
      await repo.insertGroup({ id: "g_novel", name: "小说", order: 0 });
      await repo.putCategory({ id: "logic", name: "逻辑", prompt: "p", enabled: true, defaultSelected: true, order: 0, currentVersion: 1, groupId: "g_novel" });
      await repo.putCategory({ id: "clarity", name: "清晰度", prompt: "p", enabled: true, defaultSelected: false, order: 1, currentVersion: 1 });
      let cats = await repo.listCategories();
      expect(cats.find((c) => c.id === "logic")?.groupId).toBe("g_novel");
      expect(cats.find((c) => c.id === "clarity")?.groupId ?? null).toBeNull(); // 未指定 = 通用

      await repo.assignCategoryGroup("logic", null); // 移回通用
      await repo.assignCategoryGroup("clarity", "g_novel");
      cats = await repo.listCategories();
      expect(cats.find((c) => c.id === "logic")?.groupId ?? null).toBeNull();
      expect(cats.find((c) => c.id === "clarity")?.groupId).toBe("g_novel");
    });

    it("删组回落：组内类别保留且归属清空，其余字段与版本历史不动（spec: 删除分组回落通用）", async () => {
      const repo = await fresh();
      await repo.insertGroup({ id: "g_novel", name: "小说", order: 0 });
      await repo.putCategory({ id: "logic", name: "逻辑", prompt: "p1", enabled: true, defaultSelected: true, order: 0, currentVersion: 1, color: "var(--c-logic)", groupId: "g_novel" });
      await repo.appendPromptVersion("logic", "manual_edit", "p2");
      await repo.putCategory({ id: "clarity", name: "清晰度", prompt: "p", enabled: true, defaultSelected: false, order: 1, currentVersion: 1 }); // 通用，不受影响

      await repo.deleteGroup("g_novel");
      const cats = await repo.listCategories();
      expect(cats).toHaveLength(2); // MUST NOT 删除类别
      const logic = cats.find((c) => c.id === "logic")!;
      expect(logic.groupId ?? null).toBeNull(); // 回落通用
      expect(logic.color).toBe("var(--c-logic)");
      expect(logic.enabled).toBe(true);
      expect(logic.defaultSelected).toBe(true);
      expect(logic.prompt).toBe("p1");
      expect(logic.currentVersion).toBe(2); // 版本指针不动
      expect((await repo.listPromptVersions("logic")).map((v) => v.version)).toEqual([1, 2]); // 版本历史不变
      expect(cats.find((c) => c.id === "clarity")?.groupId ?? null).toBeNull();
    });
  });

  describe("审阅区契约（幂等写入 + 快照读取）", () => {
    async function seedReview(repo: Repo): Promise<void> {
      await repo.insertProject({ id: "p1", name: "季度报告", createdAt: NOW, updatedAt: NOW });
      await repo.insertRound({
        id: "r1", projectId: "p1", number: 1, status: "completed",
        categorySnapshot: [{ categoryId: "logic", version: 1 }],
        modelSnapshot: { logic: "m1" }, createdAt: NOW,
      });
      await repo.insertDocument({ id: "d1", roundId: "r1", text: "# t\n\n正文", sourceMeta: { kind: "docx", filename: "a.docx", importedAt: NOW }, createdAt: NOW });
      await repo.insertBlocks("d1", [
        { seq: 0, type: "heading1", rawText: "# t", plainText: "t", line: 1 },
        { seq: 1, type: "paragraph", rawText: "正文", plainText: "正文", line: 3 },
      ]);
      await repo.upsertRun({ id: "run1", roundId: "r1", categoryId: "logic", categoryVersion: 1, modelConfigId: "m1", status: "completed" });
      await repo.insertFindings([
        {
          id: "f1", roundId: "r1", runId: "run1", categoryId: "logic", severity: "high",
          title: "推理跳跃", quote: "正文", blockSeq: 1, line: 3, startOffset: 0, endOffset: 2,
          problem: "p", reason: "r", suggestion: "s", anchorStatus: "anchored",
          // 多锚样本（spec: finding-anchor-spans）：行范围主锚 + 引用锚，双实现往返必须无损
          anchors: [
            { role: "primary", scope: "range", quote: "正文", lineHint: 3, contentHash: "ab12cd34", blockId: "block_002", line: 3, fromLine: 3, toLine: 4, anchorStatus: "anchored" },
            { role: "ref", scope: "quote", quote: "标题", lineHint: 1, blockId: "block_001", line: 1, startOffset: 0, endOffset: 1, anchorStatus: "anchored" },
          ],
        },
        {
          // 旧形态样本：无 anchors（v1 历史数据兼容路径）
          id: "f2", roundId: "r1", runId: "run1", categoryId: "logic", severity: "low",
          title: "啰嗦", quote: "正文", blockSeq: 1, line: 3, startOffset: 0, endOffset: 2,
          problem: "p2", reason: "r2", suggestion: "s2", anchorStatus: "anchored",
        },
      ]);
      await repo.putReport({
        roundId: "r1", summary: "总览", priorityFindingIds: ["f1"],
        categorySummaries: [{ categoryId: "logic", high: 1, medium: 0, low: 0, summary: "x" }],
        failedCategoryIds: [], generatedAt: NOW,
      });
    }

    it("写入后 loadRound 快照完整（round/document/blocks/runs/findings/report）", async () => {
      const repo = await fresh();
      await seedReview(repo);
      const snap = await repo.loadRound("r1");
      expect(snap).not.toBeNull();
      expect(snap!.round.number).toBe(1);
      expect(snap!.round.categorySnapshot).toEqual([{ categoryId: "logic", version: 1 }]);
      expect(snap!.document.sourceMeta).toEqual({ kind: "docx", filename: "a.docx", importedAt: NOW });
      expect(snap!.blocks).toHaveLength(2);
      expect(snap!.blocks[1].line).toBe(3);
      expect(snap!.runs[0].categoryVersion).toBe(1);
      expect(snap!.findings[0].blockSeq).toBe(1);
      expect(snap!.report!.priorityFindingIds).toEqual(["f1"]);
      expect(await repo.listProjects()).toHaveLength(1);
      expect(await repo.loadRound("nope")).toBeNull();
    });

    it("多锚结构往返无损；无 anchors 的旧行读回 undefined（spec: finding-anchor-spans）", async () => {
      const repo = await fresh();
      await seedReview(repo);
      const snap = await repo.loadRound("r1");
      const f1 = snap!.findings.find((f) => f.id === "f1")!;
      const f2 = snap!.findings.find((f) => f.id === "f2")!;
      expect(f1.anchors).toHaveLength(2);
      expect(f1.anchors![0]).toMatchObject({ role: "primary", scope: "range", fromLine: 3, toLine: 4 });
      expect(f1.anchors![1]).toMatchObject({ role: "ref", scope: "quote", line: 1 });
      expect(f2.anchors).toBeUndefined();
    });

    it("重复写入幂等（首迁安全重放的前提）", async () => {
      const repo = await fresh();
      await seedReview(repo);
      await seedReview(repo); // 全量重放
      const snap = await repo.loadRound("r1");
      expect(snap!.findings).toHaveLength(2);
      expect(snap!.blocks).toHaveLength(2);
      expect(await repo.listProjects()).toHaveLength(1);
      expect((await repo.listPromptVersions("logic")).length).toBeLessThanOrEqual(3); // 类别未重复种版本（另一测试覆盖）
    });
  });

  describe("API 面（tasks 1.4：不可变轮次约束）", () => {
    it("findings/documents/reports 的禁改写方法不存在", async () => {
      const repo = await fresh();
      const surface = repo as unknown as Record<string, unknown>;
      for (const name of FORBIDDEN_REPO_METHODS) {
        expect(surface[name as string], `method ${name} must not exist`).toBeUndefined();
      }
    });
  });
}
