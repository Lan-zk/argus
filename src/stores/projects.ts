// projectsStore（review-versioning 里程碑 1，spec: review-versioning 命名审阅项目/轮次管理）。
// 项目与轮次的生命周期、崩溃恢复（悬挂 running → partial_failed）、lastActive 位置记忆。

import { defineStore } from "pinia";
import { getRepo } from "../lib/repo";
import type { ProjectRow, RoundRow } from "../lib/repo/types";
import { dlog } from "../domain/log";
import { recomputeAfterDeletion } from "../lib/round-links";
import { useDeletionStore } from "./deletion";

function uid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export const useProjectsStore = defineStore("projects", {
  state: () => ({
    projects: [] as ProjectRow[],
    /** projectId → 轮次列表（懒加载：打开项目时填充）。 */
    roundsByProject: {} as Record<string, RoundRow[]>,
    activeProjectId: null as string | null,
    activeRoundId: null as string | null,
    loaded: false,
  }),

  getters: {
    activeProject: (s) => s.projects.find((p) => p.id === s.activeProjectId) ?? null,
    activeRounds: (s) => (s.activeProjectId ? s.roundsByProject[s.activeProjectId] ?? [] : []),
    activeRound(): RoundRow | null {
      return this.activeRounds.find((r) => r.id === this.activeRoundId) ?? null;
    },
  },

  actions: {
    async init() {
      if (this.loaded) return;
      const repo = getRepo();
      this.projects = await repo.listProjects();
      // 崩溃恢复：悬挂 running（上次退出未终态）→ partial_failed，已落库部分结果可查看（spec: 恢复审阅工作区）
      let recovered = 0;
      for (const p of this.projects) {
        const rounds = await repo.listRounds(p.id);
        for (const r of rounds) {
          if (r.status === "running") {
            await repo.updateRoundStatus(r.id, "partial_failed");
            r.status = "partial_failed";
            recovered++;
          }
        }
        this.roundsByProject[p.id] = rounds;
      }
      if (recovered > 0) dlog("恢复", `${recovered} 个悬挂轮次标记为未完成（部分结果可查看）`, true);
      // lastActive 位置恢复
      const last = await repo.getPref<{ projectId: string; roundId: string | null }>("lastActive");
      if (last && this.projects.some((p) => p.id === last.projectId)) {
        this.activeProjectId = last.projectId;
        this.activeRoundId = last.roundId;
      }
      this.loaded = true;
    },

    async createProject(name: string): Promise<ProjectRow> {
      const now = new Date().toISOString();
      const p: ProjectRow = { id: uid("proj"), name: name.trim() || "未命名审阅", createdAt: now, updatedAt: now };
      await getRepo().insertProject(p);
      this.projects.push(p);
      this.roundsByProject[p.id] = [];
      this.activeProjectId = p.id;
      return p;
    },

    async renameProject(id: string, name: string) {
      const n = name.trim();
      if (!n) return;
      await getRepo().renameProject(id, n);
      const p = this.projects.find((x) => x.id === id);
      if (p) p.name = n;
    },

    /** 硬删（内部/测试用）。 */
    async deleteProject(id: string) {
      await getRepo().deleteProject(id);
      this.projects = this.projects.filter((p) => p.id !== id);
      delete this.roundsByProject[id];
      if (this.activeProjectId === id) {
        this.activeProjectId = null;
        this.activeRoundId = null;
      }
    },

    /** 软删项目：立即从列表隐藏，8 秒后落删，期间可撤销（deletion store）。 */
    async requestDeleteProject(id: string) {
      const name = this.projects.find((p) => p.id === id)?.name ?? "项目";
      const deletion = useDeletionStore();
      deletion.request({
        id,
        label: `已删除「${name}」（含全部轮次）`,
        commit: async () => {
          await getRepo().deleteProject(id);
        },
        restore: async () => {
          await this.reloadLists();
        },
      });
      // 界面先行移除（数据未动）
      this.projects = this.projects.filter((p) => p.id !== id);
      delete this.roundsByProject[id];
      if (this.activeProjectId === id) {
        this.activeProjectId = null;
        this.activeRoundId = null;
      }
    },

    async refreshRounds(projectId: string) {
      this.roundsByProject[projectId] = await getRepo().listRounds(projectId);
    },

    /** 从库重建项目与轮次列表（软删撤销后的视图恢复）。 */
    async reloadLists() {
      const repo = getRepo();
      this.projects = await repo.listProjects();
      for (const p of this.projects) {
        if (!this.roundsByProject[p.id]) this.roundsByProject[p.id] = await repo.listRounds(p.id);
      }
      if (this.activeProjectId && !this.projects.some((p) => p.id === this.activeProjectId)) {
        this.activeProjectId = null;
        this.activeRoundId = null;
      }
    },

    /** 软删轮次：立即隐藏，8 秒后落删（含相邻对 links 补算），期间可撤销。 */
    async requestDeleteRound(roundId: string) {
      const pid = this.activeProjectId;
      const round = pid ? (this.roundsByProject[pid] ?? []).find((r) => r.id === roundId) : undefined;
      if (!pid || !round) return;
      const deletion = useDeletionStore();
      // hide 会先把轮次从 store 列表移除，commit 时捕获 projectId/number 直传（否则相邻位查不到）
      const meta = { projectId: pid, number: round.number };
      deletion.request({
        id: roundId,
        label: `已删除第 ${round.number} 轮`,
        commit: async () => {
          await this.deleteRound(roundId, meta); // 硬删 + 相邻对补算
        },
        restore: async () => {
          await this.refreshRounds(pid);
        },
      });
      // 界面先行移除；活动轮回退到最近剩余轮
      this.roundsByProject[pid] = (this.roundsByProject[pid] ?? []).filter((r) => r.id !== roundId);
      if (this.activeRoundId === roundId) {
        this.activeRoundId = (this.roundsByProject[pid] ?? [])[
          (this.roundsByProject[pid] ?? []).length - 1
        ]?.id ?? null;
      }
    },

    /** 硬删轮次（spec: 删除后对比自动改为剩余相邻轮之间进行 → 补算新相邻对 links）。meta 供软删 commit 路径直传。 */
    async deleteRound(roundId: string, meta?: { projectId: string; number: number }) {
      const repo = getRepo();
      const before = meta ?? (this.activeProjectId ? (this.roundsByProject[this.activeProjectId] ?? []).find((r) => r.id === roundId) : undefined);
      await repo.deleteRound(roundId);
      // 删除后新形成的相邻对（删除位两侧最近的剩余轮）补算
      if (before) {
        await recomputeAfterDeletion(repo, before.projectId, before.number);
      }
      const pid = this.activeProjectId;
      if (pid) await this.refreshRounds(pid);
      if (this.activeRoundId === roundId) {
        const remaining = pid ? this.roundsByProject[pid] ?? [] : [];
        this.activeRoundId = remaining[remaining.length - 1]?.id ?? null; // 回退到最近剩余轮
      }
    },

    /** 会话开启新一轮后登记（由 session store 调用）。 */
    async registerRound(round: RoundRow) {
      await getRepo().insertRound(round);
      const list = this.roundsByProject[round.projectId] ?? [];
      this.roundsByProject[round.projectId] = [...list, round].sort((a, b) => a.number - b.number);
      this.activeProjectId = round.projectId;
      this.activeRoundId = round.id;
      await getRepo().setPref("lastActive", { projectId: round.projectId, roundId: round.id });
    },

    /** 打开项目（列表页进入）：激活项目与其最近活动轮次。 */
    async openProject(projectId: string) {
      this.activeProjectId = projectId;
      await this.refreshRounds(projectId);
      const rounds = this.roundsByProject[projectId] ?? [];
      this.activeRoundId = rounds[rounds.length - 1]?.id ?? null;
      await getRepo().setPref("lastActive", { projectId, roundId: this.activeRoundId });
    },

    async setActiveRound(roundId: string) {
      this.activeRoundId = roundId;
      if (this.activeProjectId) {
        await getRepo().setPref("lastActive", { projectId: this.activeProjectId, roundId });
      }
    },
  },
});
