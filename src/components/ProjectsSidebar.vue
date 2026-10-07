<script setup lang="ts">
// 审阅侧栏（settings-in-sidebar：侧栏 = chrome）——品牌 / 新建审阅 / 项目列表 / 底部账户行（设置入口）。
// 项目切换入口常驻：点击即切换活动项目并加载其最近轮次；新建/重命名/删除（软删+撤销）收纳于此。
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useProjectsStore } from "../stores/projects";
import { useUiStore } from "../stores/ui";
import { useSessionStore } from "../stores/session";
import { useSettingsStore } from "../stores/settings";
import { useOnboardingStore } from "../stores/onboarding";
import { getRepo } from "../lib/repo";

const projects = useProjectsStore();
const ui = useUiStore();
const session = useSessionStore();
const settings = useSettingsStore();
const onboarding = useOnboardingStore();

const creating = ref(false);
const blockedNote = ref("");
const newName = ref("");
const renamingId = ref<string | null>(null);
const renameValue = ref("");

let blockedTimer: ReturnType<typeof setTimeout> | null = null;
async function openProject(id: string) {
  if (session.isRunning && id !== projects.activeProjectId) {
    // 不静默吞点击（评审 P1）：给出可读原因与出路
    blockedNote.value = "审阅进行中，完成后即可切换项目";
    if (blockedTimer) clearTimeout(blockedTimer);
    blockedTimer = setTimeout(() => (blockedNote.value = ""), 2500);
    return;
  }
  await projects.openProject(id);
  const roundId = projects.activeRoundId;
  if (roundId) {
    const snap = await getRepo().loadRound(roundId);
    if (snap) {
      await session.restoreRound(snap);
      ui.goReview("workspace");
      return;
    }
  }
  ui.goReview("new");
}

async function createProject() {
  const p = await projects.createProject(newName.value);
  newName.value = "";
  creating.value = false;
  ui.goReview("new");
  void p;
}

async function commitRename(id: string) {
  await projects.renameProject(id, renameValue.value);
  renamingId.value = null;
}

// ---- 底部账户行与菜单（settings-in-sidebar design D1）----
const menuOpen = ref(false);
const menuStyle = ref<{ left: string; bottom: string }>({ left: "0px", bottom: "0px" });
const acctBtn = ref<HTMLElement | null>(null);
const acctModel = computed(() => settings.defaultModel);
const acctName = computed(() => acctModel.value?.displayName || acctModel.value?.model || "未配置模型");

function toggleMenu() {
  menuOpen.value = !menuOpen.value;
  if (menuOpen.value && acctBtn.value) {
    const r = acctBtn.value.getBoundingClientRect();
    menuStyle.value = { left: `${r.left}px`, bottom: `${window.innerHeight - r.top + 6}px` };
  }
}
function closeMenu() {
  menuOpen.value = false;
}
function goSettings() {
  closeMenu();
  ui.go("settings");
}
function toggleThemeAxis() {
  void settings.setTheme(settings.ui.theme === "swiss" ? "apple" : "swiss");
  closeMenu();
}
function rerunOnboarding() {
  closeMenu();
  onboarding.start();
}
function onDocClick(e: MouseEvent) {
  if (menuOpen.value && acctBtn.value && !acctBtn.value.contains(e.target as Node)) closeMenu();
}
function onKey(e: KeyboardEvent) {
  if (e.key === "Escape") closeMenu();
}
onMounted(() => {
  document.addEventListener("click", onDocClick);
  window.addEventListener("keydown", onKey);
});
onBeforeUnmount(() => {
  document.removeEventListener("click", onDocClick);
  window.removeEventListener("keydown", onKey);
});
</script>

<template>
  <aside class="psb" :class="{ collapsed: ui.sidebarCollapsed }" aria-label="审阅项目列表">
    <div class="psb-head">
      <img class="sq" src="/icon.png" alt="" draggable="false" />
      <div><b>ARGUS</b><span class="microlabel">AI 文稿审阅</span></div>
      <button class="icon-btn psb-collapse" title="收起侧栏（⌘B）" aria-label="收起侧栏" @click="ui.toggleSidebar()">«</button>
    </div>

    <button class="primary psb-new" @click="creating = !creating">＋ 新建审阅</button>

    <div v-if="creating" class="psb-create">
      <input
        v-model="newName"
        type="text"
        placeholder="项目名称…"
        aria-label="项目名称"
        @keyup.enter="createProject"
        @keyup.esc="creating = false"
      />
      <div class="psb-create-acts">
        <button class="mini primary" :disabled="!newName.trim()" @click="createProject">创建</button>
        <button class="mini" @click="creating = false">取消</button>
      </div>
    </div>

    <div v-if="blockedNote" class="psb-blocked" role="status">{{ blockedNote }}</div>

    <div class="psb-list">
      <div v-if="projects.projects.length === 0" class="psb-empty">
        还没有审阅项目
      </div>
      <div
        v-for="p in projects.projects"
        :key="p.id"
        class="psb-row"
        :class="{ on: p.id === projects.activeProjectId }"
        role="button"
        :tabindex="renamingId === p.id ? -1 : 0"
        :aria-current="p.id === projects.activeProjectId ? 'true' : undefined"
        @click="openProject(p.id)"
        @keydown.enter="openProject(p.id)"
        @keydown.space.prevent="openProject(p.id)"
      >
        <template v-if="renamingId === p.id">
          <input
            v-model="renameValue"
            type="text"
            aria-label="重命名项目"
            @keyup.enter="commitRename(p.id)"
            @keyup.esc="renamingId = null"
            @click.stop
          />
        </template>
        <template v-else>
          <span class="psb-name">{{ p.name }}</span>
          <span class="psb-meta">
            <span v-if="(projects.roundsByProject[p.id] ?? []).some((r) => r.status === 'running')" class="live" title="审阅进行中">●</span>
            {{ (projects.roundsByProject[p.id] ?? []).length }} 轮
          </span>
          <span class="acts" @click.stop>
            <button class="icon-btn" title="重命名" aria-label="重命名" @click="renamingId = p.id; renameValue = p.name">✎</button>
            <button class="icon-btn danger" title="删除（8 秒内可撤销）" aria-label="删除" @click="projects.requestDeleteProject(p.id)">✕</button>
          </span>
        </template>
      </div>
    </div>

    <!-- 底部账户行（settings-in-sidebar：设置入口，Codex 式底部固定区） -->
    <div class="psb-foot">
      <button
        ref="acctBtn"
        class="psb-acct"
        :class="{ on: ui.page === 'settings' }"
        :aria-haspopup="'menu'"
        :aria-expanded="menuOpen"
        aria-label="账户与设置菜单"
        @click.stop="toggleMenu"
      >
        <span class="dot"></span>
        <b>{{ acctName }}</b>
        <span class="st">{{ acctModel ? "· 就绪" : "" }}</span>
        <span class="chev">▲</span>
      </button>
    </div>
  </aside>

  <!-- 账户菜单（复用 .pop 浮层词汇；Apple 皮肤走磨砂 + 系统菜单影 + accent 选中） -->
  <div v-if="menuOpen" class="pop acct-menu" :style="menuStyle" role="menu" @click.stop>
    <div class="pop-h">{{ acctModel ? acctModel.displayName || acctModel.model : "未配置模型" }}</div>
    <div class="pop-item" role="menuitem" @click="goSettings">⚙ 设置<span class="pop-k">⌘,</span></div>
    <div class="pop-item" role="menuitem" @click="toggleThemeAxis">
      {{ settings.ui.theme === "swiss" ? "◐ 切换为 Apple 风格" : "◐ 切换为瑞士风格" }}
    </div>
    <div class="pop-item" role="menuitem" @click="rerunOnboarding">↻ 重新运行引导</div>
    <div class="pop-foot">ARGUS · 本地审阅 · 数据不出本机</div>
  </div>
</template>

<style scoped>
.psb {
  flex: 0 0 236px;
  display: flex;
  flex-direction: column;
  min-height: 0;
  border-right: var(--hair);
  background: var(--paper2);
}
.psb.collapsed {
  display: none;
}
/* 品牌头部：瑞士皮肤保留 6px 墨线（原顶栏墨线语言转移至此），Apple 换发丝线 */
.psb-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 14px 12px;
  border-bottom: 6px solid var(--ink);
}
.psb-head .sq {
  width: 22px;
  height: 22px;
  display: block;
}
.psb-head b {
  font-size: 14px;
  letter-spacing: 0.02em;
}
.psb-head .microlabel {
  display: block;
  margin-top: 1px;
}
.psb-collapse {
  margin-left: auto;
}
/* 新建主操作 = 侧栏紧凑方言（layout 修复：全局 primary 的 Apple 大胶囊 17px/11px 内距在 236px 窄栏里
   高达 ~45px 如横幅；侧栏统一压到 ~29px——swiss 12px 工具件，apple 13px 紧凑小胶囊） */
.psb-new {
  margin: 10px 14px 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  font-size: 12px;
  padding: 6px 12px;
}
[data-theme^="apple"] .psb-new {
  font-size: 13px;
  letter-spacing: -0.1px;
  padding: 5px 14px;
  border-radius: var(--radius-round);
}
/* P2-5：Apple 只换边线语言（墨线→发丝线），不改盒体内外距 */
[data-theme^="apple"] .psb-head {
  border-bottom: var(--hair);
}
[data-theme^="apple"] .psb-head b {
  font-weight: 600;
}
/* P2-4：与上方 .psb-new 的 14px 边距对齐（原 12px 左偏 2px） */
.psb-create {
  padding: 0 14px 10px;
}
.psb-create input {
  font-size: 12.5px;
  padding: 6px 8px;
}
.psb-create-acts {
  display: flex;
  gap: 6px;
  margin-top: 6px;
}
.psb-list {
  flex: 1;
  overflow-y: auto;
  padding: 0 8px;
}
.psb-empty {
  font-size: 12px;
  color: var(--ink50);
  padding: 18px 10px;
  text-align: center;
}
/* 行布局单行化（layout 修复：wrap+baseline 下 hover 出现的操作钮会把元信息挤到第二行、行高跳变；
   改为 name 弹性省略 + meta/acts 固定不换行，行高稳定） */
.psb-row {
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  gap: 4px 8px;
  margin-bottom: 2px;
}
.psb-row:hover {
  background: var(--card);
}
.psb-row.on {
  background: var(--card);
  box-shadow: inset 2px 0 0 var(--ink);
}
/* Apple：macOS 侧栏选中语法——accent 淡填充 + 标题 accent 色 */
[data-theme^="apple"] .psb-row.on {
  background: color-mix(in srgb, var(--accent) 10%, transparent);
  box-shadow: none;
}
[data-theme^="apple"] .psb-row.on .psb-name {
  color: var(--accent);
}
.psb-row input {
  font-size: 12.5px;
  padding: 4px 6px;
  flex: 1;
  min-width: 0;
}
.psb-name {
  font-size: 13px;
  font-weight: 600;
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.psb-meta {
  font-family: var(--mono);
  font-size: 10px;
  color: var(--ink50);
  flex-shrink: 0;
}
.psb-meta .live {
  color: var(--accent);
  animation: blink 1.2s infinite;
}
@keyframes blink {
  50% {
    opacity: 0.25;
  }
}
.psb-acts {
  display: none;
  gap: 4px;
  margin-left: auto;
}
/* 行内操作 hover/焦点才现，focus-within 同显保证键盘可达 */
.psb-row:hover .acts,
.psb-row:focus-within .acts {
  display: flex;
}
.psb-acts .icon-btn {
  padding: 2px 5px;
  font-size: 11px;
}
.psb-row:focus-visible {
  outline: 2px solid var(--accent-focus);
  outline-offset: -2px;
}
.psb-blocked {
  margin: 0 12px 8px;
  padding: 8px 10px;
  font-size: 11px;
  color: var(--ochre);
  background: color-mix(in srgb, var(--ochre) 10%, transparent);
}
.icon-btn {
  border: 1px solid var(--ink35);
  background: var(--card);
  color: var(--ink70);
  font-size: 11px;
  line-height: 1;
  padding: 3px 6px;
  cursor: pointer;
  border-radius: var(--radius-sm);
}
.icon-btn:hover {
  border-color: var(--ink);
  color: var(--ink);
}
/* 删除=高危语义，恒红系（Red Means Stop：apple 皮肤下 accent 是蓝，不得用于删除） */
.icon-btn.danger {
  color: var(--danger);
  border-color: var(--danger);
}
.icon-btn.danger:hover {
  background: var(--danger);
  color: var(--on-danger);
}
/* 底部账户行 */
.psb-foot {
  flex: 0 0 auto;
  border-top: var(--hair);
}
.psb-acct {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 8px;
  border: none;
  background: none;
  border-radius: 0;
  text-align: left;
  padding: 12px 14px;
  font-size: 12px;
  cursor: pointer;
  color: var(--ink);
  letter-spacing: normal;
  font-weight: 400;
  transition: background 0.15s var(--ease-out-quint);
}
.psb-acct:hover {
  background: var(--card);
  color: var(--ink);
}
.psb-acct .dot {
  width: 8px;
  height: 8px;
  background: var(--ok);
  flex-shrink: 0;
}
.psb-acct b {
  font-weight: 600;
  max-width: 118px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.psb-acct .st {
  color: var(--ink50);
  font-size: 11px;
}
.psb-acct .chev {
  margin-left: auto;
  color: var(--ink50);
  font-size: 10px;
}
.psb-acct.on {
  background: var(--card);
  box-shadow: inset 2px 0 0 var(--ink);
}
[data-theme^="apple"] .psb-acct.on {
  background: color-mix(in srgb, var(--accent) 10%, transparent);
  box-shadow: none;
}
[data-theme^="apple"] .psb-acct.on b {
  color: var(--accent);
}
/* 账户菜单（.pop 全局词汇之上的收尾行） */
.acct-menu {
  min-width: 224px;
}
.acct-menu .pop-k {
  margin-left: auto;
  font-family: var(--mono);
  font-size: 10px;
  color: var(--ink50);
}
.acct-menu .pop-foot {
  font-size: 10px;
  font-family: var(--mono);
  color: var(--ink50);
  padding: 8px 12px;
  border-top: var(--hair);
}
</style>
