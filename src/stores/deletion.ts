// deletionStore：删除的「软删 + 撤销」缓冲（评审启发性问题 2 / 用户选型）。
// hide 立即执行（界面消失）→ 8 秒后 commit 真正落删；undo 在窗口期内 restore 回滚。
// 替代两套内联确认模式与武装态按钮。

import { defineStore } from "pinia";

interface PendingDeletion {
  id: string;
  label: string;
  commit: () => Promise<void> | void;
  restore: () => Promise<void> | void;
  timer: ReturnType<typeof setTimeout>;
}

export const useDeletionStore = defineStore("deletion", {
  state: () => ({
    pending: [] as PendingDeletion[],
  }),

  getters: {
    active: (s): PendingDeletion | null => s.pending[0] ?? null,
  },

  actions: {
    request(opts: {
      id: string;
      label: string;
      commit: () => Promise<void> | void;
      restore: () => Promise<void> | void;
    }) {
      this.discard(opts.id); // 同 id 重复请求：丢弃前一个（未落删）
      const pending: PendingDeletion = {
        ...opts,
        timer: setTimeout(() => void this.commit(opts.id), 8000),
      };
      this.pending.push(pending);
    },

    async commit(id: string) {
      const idx = this.pending.findIndex((p) => p.id === id);
      if (idx < 0) return;
      const [p] = this.pending.splice(idx, 1);
      clearTimeout(p.timer);
      await p.commit();
    },

    async undo() {
      const [p] = this.pending.splice(0, 1);
      if (!p) return;
      clearTimeout(p.timer);
      await p.restore();
    },

    discard(id: string) {
      const idx = this.pending.findIndex((p) => p.id === id);
      if (idx >= 0) {
        const [p] = this.pending.splice(idx, 1);
        clearTimeout(p.timer);
        p.restore(); // 未落删：恢复视图
      }
    },
  },
});
