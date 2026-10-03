<script setup lang="ts">
// ARGUS 外壳：顶部导航 + 三页切换（spec: review-ui）。
import { onMounted } from "vue";
import { useUiStore } from "./stores/ui";
import { useSettingsStore } from "./stores/settings";
import { useSessionStore } from "./stores/session";
import NewReviewPage from "./pages/NewReviewPage.vue";
import WorkspacePage from "./pages/WorkspacePage.vue";
import SettingsPage from "./pages/SettingsPage.vue";
import { runDevSpikeIfRequested } from "./lib/dev-spike";

const ui = useUiStore();
const settings = useSettingsStore();
const session = useSessionStore();

onMounted(async () => {
  session.bindLogger();
  await settings.init();
  // 重启恢复：存在最近一次 Review 时回灌并显示恢复提示条（spec: app-persistence）
  if (settings.lastReview) {
    session.restore(settings.lastReview);
  }
  // 开发联调钩子（debug 构建且存在 spike-request.json 时才执行）
  void runDevSpikeIfRequested();
});
</script>

<template>
  <nav>
    <div class="brand">
      <div class="sq"></div>
      <div><b>ARGUS</b><span class="microlabel">AI 文稿审阅</span></div>
    </div>
    <div class="navtabs">
      <div class="navtab" :class="{ on: ui.page === 'new' }" data-page="new" @click="ui.go('new')">
        <span class="no">01</span>新建审阅
      </div>
      <div
        class="navtab"
        :class="{ on: ui.page === 'workspace' }"
        data-page="ws"
        @click="ui.go('workspace')"
      >
        <span class="no">02</span>审阅工作台
        <span v-if="session.findings.length" class="session-chip">{{ session.findings.length }}</span>
      </div>
      <div
        class="navtab"
        :class="{ on: ui.page === 'settings' }"
        data-page="settings"
        @click="ui.go('settings')"
      >
        <span class="no">03</span>设置
      </div>
    </div>
  </nav>

  <NewReviewPage v-show="ui.page === 'new'" />
  <WorkspacePage v-show="ui.page === 'workspace'" />
  <SettingsPage v-show="ui.page === 'settings'" />
</template>
