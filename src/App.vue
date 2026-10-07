<script setup lang="ts">
// ARGUS 外壳（settings-in-sidebar：侧栏 = chrome，无全局顶栏）。
// 左栏：品牌 + 新建审阅 + 项目列表 + 底部账户行（设置入口）；主区：审阅视图（新一轮/工作台）或设置页。
import { onMounted, onBeforeUnmount } from "vue";
import { useUiStore } from "./stores/ui";
import { useSettingsStore } from "./stores/settings";
import { useSessionStore } from "./stores/session";
import { useProjectsStore } from "./stores/projects";
import { useOnboardingStore } from "./stores/onboarding";
import ProjectsSidebar from "./components/ProjectsSidebar.vue";
import NewReviewPage from "./pages/NewReviewPage.vue";
import WorkspacePage from "./pages/WorkspacePage.vue";
import SettingsPage from "./pages/SettingsPage.vue";
import OnboardingLayer from "./components/OnboardingLayer.vue";
import UpdateBanner from "./components/UpdateBanner.vue";
import { runDevSpikeIfRequested } from "./lib/dev-spike";
import { getRepo } from "./lib/repo";
import { useDeletionStore } from "./stores/deletion";
import { useUpdateStore } from "./stores/update";

const ui = useUiStore();
const settings = useSettingsStore();
const deletion = useDeletionStore();
const session = useSessionStore();
const projects = useProjectsStore();
const onboarding = useOnboardingStore();
const update = useUpdateStore();

// 首帧判定（spec: onboarding / design D3 双检之一）：主路径 setup 时设置已加载（main.ts mount 前 init），
// 同步决定弹引导，层与首帧同现、零主界面闪烁
onboarding.maybeAutoStart();

// Cmd/Ctrl+B：折叠/展开审阅侧栏；Cmd/Ctrl+,：进出设置（macOS 应用惯例）
function onGlobalKey(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "b") {
    e.preventDefault();
    ui.toggleSidebar();
  }
  if ((e.metaKey || e.ctrlKey) && e.key === ",") {
    e.preventDefault();
    if (ui.page === "settings") ui.goReview("workspace");
    else ui.go("settings");
  }
}
onMounted(() => window.addEventListener("keydown", onGlobalKey));
onBeforeUnmount(() => window.removeEventListener("keydown", onGlobalKey));

// 启动静默检查更新（spec: app-updates 版本检查时机）：延迟 3s 不抢首帧；不进 main.ts 启动链。
// 静默路径吞错、非 Tauri 环境直接 unsupported 空转，均不产生可见影响。
let updateTimer: ReturnType<typeof setTimeout> | null = null;
onMounted(() => {
  updateTimer = setTimeout(() => void update.check4Update(true), 3000);
});
onBeforeUnmount(() => {
  if (updateTimer) clearTimeout(updateTimer);
});

onMounted(async () => {
  session.bindLogger();
  await settings.init(); // 幂等兜底：main.ts 已在 mount 前初始化（theme-system 首帧防闪）；测试直挂 App 时由此加载
  ui.sidebarCollapsed = settings.ui.sidebarCollapsed ?? false;
  await projects.init();
  onboarding.maybeAutoStart(); // 双检之二：测试直挂路径 loaded 初始为 false，init 后补判
  // 重启恢复：回到最后活动项目与轮次（spec: app-persistence 恢复审阅工作区——恢复时 MUST 有明确提示）
  const roundId = projects.activeRoundId;
  if (roundId) {
    const snap = await getRepo().loadRound(roundId);
    if (snap) {
      await session.restoreRound(snap, { banner: true });
      ui.goReview("workspace");
    }
  }
  // 开发联调钩子（debug 构建且存在 spike-request.json 时才执行）
  void runDevSpikeIfRequested();
});
</script>

<template>
  <!-- 降级保护 / 首迁失败提示（spec: app-persistence 存储迁移与版本兼容） -->
  <div v-if="settings.storageReadOnly" class="storage-banner">
    存储由更新版本的应用创建，当前以只读模式运行 —— 请升级应用后再修改数据。
  </div>
  <div v-else-if="settings.migrationFailed" class="storage-banner warn">
    旧数据迁移未完成，本次以现有数据运行；重启应用后将自动重试，原始数据不受影响。
  </div>
  <!-- 更新提示横幅（update store：available/下载/安装/失败各态；available 可关闭） -->
  <UpdateBanner />

  <!-- 侧栏 = chrome（review 与 settings 两页均常驻，可折叠）；折叠态换 44px 图标栏占位（不悬浮遮挡内容）；主区 = 当前视图 -->
  <div class="shell-body">
    <ProjectsSidebar />
    <nav v-if="ui.sidebarCollapsed" class="psb-rail" aria-label="审阅列表已折叠">
      <button
        class="psb-rail-btn"
        title="展开审阅列表（⌘B）"
        aria-label="展开审阅列表"
        @click="ui.toggleSidebar()"
      >
        ☰
      </button>
    </nav>
    <main class="shell-main">
      <NewReviewPage v-if="ui.page === 'review' && ui.reviewView === 'new'" />
      <WorkspacePage v-else-if="ui.page === 'review'" />
      <SettingsPage v-else />
    </main>
  </div>
  <OnboardingLayer />

  <!-- 软删撤销浮条（deletion store：8 秒窗口）；退出快于进入（150ms），窗口到点不突兀消失。
       Apple 皮肤 = macOS 磨砂玻璃胶囊卡（settings-in-sidebar design D4） -->
  <Transition name="undo">
    <div v-if="deletion.active" class="undo-bar" role="status">
      <span>{{ deletion.active.label }}</span>
      <button class="mini primary" @click="deletion.undo()">撤销</button>
    </div>
  </Transition>
</template>

<style scoped>
.shell-body {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
}
.shell-main {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
/* 折叠态图标栏：占位于文档流（修复 absolute 悬浮钮与主区左上内容重叠） */
.psb-rail {
  flex: 0 0 44px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding-top: 10px;
  border-right: var(--hair);
  background: var(--paper2);
}
.psb-rail-btn {
  border: 1px solid var(--ink35);
  background: var(--card);
  color: var(--ink70);
  font-size: 13px;
  line-height: 1;
  padding: 6px 8px;
  cursor: pointer;
  border-radius: var(--radius-sm);
}
.psb-rail-btn:hover {
  border-color: var(--ink);
  color: var(--ink);
}
.storage-banner {
  flex: 0 0 auto;
  padding: 8px 28px;
  font-size: 12px;
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 7%, transparent);
  border-bottom: 1px solid color-mix(in srgb, var(--accent) 35%, transparent);
}
.storage-banner.warn {
  color: var(--ochre);
  background: color-mix(in srgb, var(--ochre) 7%, transparent);
  border-bottom-color: color-mix(in srgb, var(--ochre) 35%, transparent);
}
.undo-bar {
  position: fixed;
  right: 24px;
  bottom: 24px;
  z-index: var(--z-float);
  display: flex;
  align-items: center;
  gap: 12px;
  background: var(--ink);
  color: var(--paper);
  font-size: 12.5px;
  padding: 10px 10px 10px 16px;
  border: 1.5px solid var(--accent);
  animation: undo-in 0.2s cubic-bezier(0.2, 0.8, 0.2, 1);
}
.undo-bar button {
  border-color: var(--paper);
  background: none;
  color: var(--paper);
}
.undo-bar button:hover {
  background: var(--paper);
  color: var(--ink);
}
@keyframes undo-in {
  from {
    transform: translateY(8px);
    opacity: 0;
  }
}
.undo-leave-active {
  transition: opacity 0.15s var(--ease-out-quint), transform 0.15s var(--ease-out-quint);
}
.undo-leave-to {
  opacity: 0;
  transform: translateY(6px);
}
@media (prefers-reduced-motion: reduce) {
  .undo-bar {
    animation: none;
  }
}
/* Apple：撤销浮条 = macOS 通知形态磨砂玻璃胶囊（settings-in-sidebar design D4-3） */
[data-theme^="apple"] .undo-bar {
  background: color-mix(in srgb, var(--card) 72%, transparent);
  backdrop-filter: saturate(180%) blur(20px);
  -webkit-backdrop-filter: saturate(180%) blur(20px);
  color: var(--ink);
  border: 1px solid var(--ink15);
  border-radius: 14px;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.14), 0 1px 3px rgba(0, 0, 0, 0.08);
}
[data-theme^="apple"] .undo-bar button {
  background: var(--cta);
  border-color: transparent;
  color: var(--on-cta);
}
[data-theme^="apple"] .undo-bar button:hover {
  background: var(--cta-hover);
  color: var(--on-cta);
}
</style>
