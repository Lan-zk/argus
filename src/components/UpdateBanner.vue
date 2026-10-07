<script setup lang="ts">
// UpdateBanner（spec: app-updates 更新提示与用户确认 / auto-update design D2）：
// 顶部非模态横幅，消费 update store；available（可关闭，本次运行不再弹出）与下载/安装/失败各态。
// 语义色铁律：更新提示走 --accent（品牌强调），仅失败文案用 --danger。
import { computed } from "vue";
import { useUpdateStore } from "../stores/update";

const update = useUpdateStore();

const notesSummary = computed(() => {
  const n = update.pending?.notes?.trim();
  return n ? (n.length > 60 ? n.slice(0, 60) + "…" : n) : "";
});
</script>

<template>
  <div v-if="update.bannerVisible" class="update-banner" role="status" data-test="update-banner">
    <!-- 发现新版本：版本号 + 更新说明摘要（title 看全文），用户确认后才下载 -->
    <template v-if="update.status === 'available'">
      <span class="ub-text">
        发现新版本 <b>v{{ update.pending?.version }}</b>
        <span v-if="notesSummary" class="ub-notes" :title="update.pending?.notes">· {{ notesSummary }}</span>
      </span>
      <button class="mini primary" data-test="update-accept" @click="update.startUpdate()">立即更新</button>
      <button class="mini ub-close" data-test="update-dismiss" aria-label="关闭更新提示" @click="update.dismissBanner()">×</button>
    </template>

    <!-- 下载中：进度百分比；总大小未知时不显示数字 -->
    <template v-else-if="update.status === 'downloading'">
      <span class="ub-text">正在下载更新<template v-if="update.progress !== null"> · {{ update.progress }}%</template>…</span>
    </template>

    <!-- 安装中：Windows 上安装器会退出应用，此文案在 macOS/Linux 可见 -->
    <template v-else-if="update.status === 'installing'">
      <span class="ub-text">正在安装新版本，完成后将自动重启…</span>
    </template>

    <!-- 失败：可重试可取消，当前版本保持可用（spec「下载失败可重试」） -->
    <template v-else-if="update.status === 'install-failed'">
      <span class="ub-text ub-error">{{ update.error }}</span>
      <button class="mini primary" data-test="update-retry" @click="update.startUpdate()">重试</button>
      <button class="mini" data-test="update-cancel" @click="update.cancelFailed()">取消</button>
    </template>
  </div>
</template>

<style scoped>
/* 与 App.vue storage-banner 同形态：accent 弱底 + 细分隔线的应用级提示条 */
.update-banner {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 28px;
  font-size: 12px;
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 7%, transparent);
  border-bottom: 1px solid color-mix(in srgb, var(--accent) 35%, transparent);
}
.update-banner b {
  font-family: var(--mono);
}
.ub-text {
  flex: 0 1 auto;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ub-notes {
  color: var(--ink70);
}
.ub-error {
  color: var(--danger);
}
.update-banner button {
  flex: 0 0 auto;
}
.ub-close {
  padding: 2px 8px;
  line-height: 1;
}
</style>
