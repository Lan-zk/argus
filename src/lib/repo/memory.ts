// 内存 Repo 实现：开发/测试（无 Tauri）环境的兜底，与 SQLite 实现跑同一套契约测试。
// 结构镜像 schema v1 表；时间戳与 SQLite 实现一致使用 ISO-8601 字符串。

import type {
  BlockRow,
  CategoryGroup,
  FindingLinkRow,
  DocumentRow,
  FindingRow,
  ProjectRow,
  PromptVersionRow,
  PromptSource,
  Repo,
  ReportRow,
  RoundRow,
  RoundSnapshot,
  RunRow,
  StoredCategory,
  StoredModel,
} from "./types";

interface CategoryRecord extends StoredCategory {
  createdAt: string;
}

interface PromptVersionRecord extends PromptVersionRow {
  rowId: number;
}

export class MemoryRepo implements Repo {
  readonly kind = "memory" as const;
  readonly readOnly = false;

  private models = new Map<string, StoredModel>();
  private categories = new Map<string, CategoryRecord>();
  private groups = new Map<string, CategoryGroup>();
  private promptVersions = new Map<string, PromptVersionRecord[]>();
  private prefs = new Map<string, unknown>();
  private projects = new Map<string, ProjectRow>();
  private rounds = new Map<string, RoundRow>();
  private documents = new Map<string, DocumentRow>();
  private blocks = new Map<string, BlockRow[]>();
  private runs = new Map<string, RunRow>();
  private findings = new Map<string, FindingRow>();
  private reports = new Map<string, ReportRow>();
  private links: FindingLinkRow[] = [];
  private versionRowSeq = 0;

  async open(): Promise<void> {
    /* 内存实现无迁移，恒为当前版本 */
  }

  // ---- 设置区 ----
  async listModels(): Promise<StoredModel[]> {
    return [...this.models.values()];
  }

  async putModel(m: StoredModel): Promise<void> {
    this.models.set(m.id, { ...m });
  }

  async deleteModel(id: string): Promise<void> {
    this.models.delete(id);
  }

  async listCategories(): Promise<StoredCategory[]> {
    return [...this.categories.values()]
      .map(({ createdAt: _createdAt, ...c }) => c)
      .sort((a, b) => a.order - b.order);
  }

  async putCategory(c: StoredCategory): Promise<void> {
    const existed = this.categories.get(c.id);
    this.categories.set(c.id, { ...c, createdAt: existed?.createdAt ?? new Date().toISOString() });
    const versions = this.promptVersions.get(c.id) ?? [];
    if (versions.length === 0) {
      // 首次落库即种 v1（builtin）——迁移、默认种子与后续新建共用同一路径
      versions.push({
        rowId: ++this.versionRowSeq,
        categoryId: c.id,
        version: 1,
        source: "builtin",
        prompt: c.prompt,
        createdAt: new Date().toISOString(),
      });
      this.promptVersions.set(c.id, versions);
    }
  }

  async deleteCategory(id: string): Promise<void> {
    this.categories.delete(id);
    this.promptVersions.delete(id);
  }

  // ---- 分组区（spec: settings 类别分组管理；与 sqlite 同语义）----
  async listGroups(): Promise<CategoryGroup[]> {
    return [...this.groups.values()].map((g) => ({ ...g })).sort((a, b) => a.order - b.order);
  }

  async insertGroup(g: CategoryGroup): Promise<void> {
    if (!this.groups.has(g.id)) this.groups.set(g.id, { ...g });
  }

  async renameGroup(id: string, name: string): Promise<void> {
    const g = this.groups.get(id);
    if (g) this.groups.set(id, { ...g, name });
  }

  async moveGroup(id: string, dir: -1 | 1): Promise<void> {
    const sorted = [...this.groups.values()].sort((a, b) => a.order - b.order);
    const idx = sorted.findIndex((g) => g.id === id);
    const swapWith = idx + dir;
    if (idx < 0 || swapWith < 0 || swapWith >= sorted.length) return;
    const a = sorted[idx];
    const b = sorted[swapWith];
    const tmp = a.order;
    a.order = b.order;
    b.order = tmp;
    this.groups.set(a.id, { ...a });
    this.groups.set(b.id, { ...b });
  }

  async deleteGroup(id: string): Promise<void> {
    for (const c of this.categories.values()) {
      if (c.groupId === id) c.groupId = null;
    }
    this.groups.delete(id);
  }

  async assignCategoryGroup(categoryId: string, groupId: string | null): Promise<void> {
    const c = this.categories.get(categoryId);
    if (c) c.groupId = groupId;
  }

  async listPromptVersions(categoryId: string): Promise<PromptVersionRow[]> {
    return (this.promptVersions.get(categoryId) ?? []).map(({ rowId: _rowId, ...v }) => v);
  }

  async getPromptVersionText(categoryId: string, version: number): Promise<string | null> {
    const hit = (this.promptVersions.get(categoryId) ?? []).find((v) => v.version === version);
    return hit?.prompt ?? null;
  }

  async appendPromptVersion(categoryId: string, source: PromptSource, prompt: string, skillMeta?: unknown): Promise<number> {
    const versions = this.promptVersions.get(categoryId) ?? [];
    const next = (versions[versions.length - 1]?.version ?? 0) + 1;
    versions.push({
      rowId: ++this.versionRowSeq,
      categoryId,
      version: next,
      source,
      prompt,
      skillMeta,
      createdAt: new Date().toISOString(),
    });
    this.promptVersions.set(categoryId, versions);
    const cat = this.categories.get(categoryId);
    if (cat) cat.currentVersion = next;
    return next;
  }

  async getPref<T>(key: string): Promise<T | undefined> {
    return this.prefs.get(key) as T | undefined;
  }

  async setPref(key: string, value: unknown): Promise<void> {
    this.prefs.set(key, value);
  }

  async deletePref(key: string): Promise<void> {
    this.prefs.delete(key);
  }

  // ---- 审阅区 ----
  async insertProject(p: ProjectRow): Promise<void> {
    if (!this.projects.has(p.id)) this.projects.set(p.id, { ...p });
  }

  async listProjects(): Promise<ProjectRow[]> {
    return [...this.projects.values()];
  }

  async renameProject(id: string, name: string): Promise<void> {
    const p = this.projects.get(id);
    if (p) this.projects.set(id, { ...p, name, updatedAt: new Date().toISOString() });
  }

  async deleteProject(id: string): Promise<void> {
    this.projects.delete(id);
    const roundIds = [...this.rounds.values()].filter((r) => r.projectId === id).map((r) => r.id);
    for (const rid of roundIds) await this.deleteRound(rid);
  }

  async listRounds(projectId: string): Promise<RoundRow[]> {
    return [...this.rounds.values()].filter((r) => r.projectId === projectId).sort((a, b) => a.number - b.number);
  }

  async updateRoundStatus(roundId: string, status: RoundRow["status"]): Promise<void> {
    const r = this.rounds.get(roundId);
    if (r) this.rounds.set(roundId, { ...r, status });
  }

  async deleteRound(roundId: string): Promise<void> {
    this.rounds.delete(roundId);
    const doc = [...this.documents.values()].find((d) => d.roundId === roundId);
    if (doc) {
      this.documents.delete(doc.id);
      this.blocks.delete(doc.id);
    }
    for (const [id, r] of [...this.runs]) if (r.roundId === roundId) this.runs.delete(id);
    for (const [id, f] of [...this.findings]) if (f.roundId === roundId) this.findings.delete(id);
    this.reports.delete(roundId);
  }

  async insertRound(r: RoundRow): Promise<void> {
    if (!this.rounds.has(r.id)) this.rounds.set(r.id, { ...r });
  }

  async insertDocument(d: DocumentRow): Promise<void> {
    if (!this.documents.has(d.id)) this.documents.set(d.id, { ...d });
  }

  async insertBlocks(documentId: string, blocks: BlockRow[]): Promise<void> {
    const existing = this.blocks.get(documentId) ?? [];
    const bySeq = new Map(existing.map((b) => [b.seq, b]));
    for (const b of blocks) bySeq.set(b.seq, { ...b });
    this.blocks.set(documentId, [...bySeq.values()].sort((a, b) => a.seq - b.seq));
  }

  async upsertRun(r: RunRow): Promise<void> {
    this.runs.set(r.id, { ...r });
  }

  async insertFindings(rows: FindingRow[]): Promise<void> {
    for (const f of rows) if (!this.findings.has(f.id)) this.findings.set(f.id, { ...f });
  }

  async deleteCategoryFindings(roundId: string, categoryId: string): Promise<void> {
    for (const [id, f] of [...this.findings]) {
      if (f.roundId === roundId && f.categoryId === categoryId) this.findings.delete(id);
    }
  }

  async putReport(r: ReportRow): Promise<void> {
    this.reports.set(r.roundId, { ...r });
  }

  async loadRound(roundId: string): Promise<RoundSnapshot | null> {
    const round = this.rounds.get(roundId);
    if (!round) return null;
    const document = [...this.documents.values()].find((d) => d.roundId === roundId);
    if (!document) return null;
    return {
      round,
      document,
      blocks: this.blocks.get(document.id) ?? [],
      runs: [...this.runs.values()].filter((r) => r.roundId === roundId),
      findings: [...this.findings.values()].filter((f) => f.roundId === roundId),
      report: this.reports.get(roundId) ?? null,
    };
  }

  async insertLinks(rows: FindingLinkRow[]): Promise<void> {
    this.links.push(...rows.map((r) => ({ ...r })));
  }

  async deleteLinksByRound(roundId: string): Promise<void> {
    this.links = this.links.filter((l) => l.currRoundId !== roundId);
  }

  async listLinksByRound(roundId: string): Promise<FindingLinkRow[]> {
    return this.links.filter((l) => l.currRoundId === roundId).map((l) => ({ ...l }));
  }
}
