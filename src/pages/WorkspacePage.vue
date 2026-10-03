<script setup lang="ts">
// Review Workspace（spec: review-ui 布局/定位/筛选/状态/加载 + review-report 回跳）。
// 双栏 60/40 可拖动记忆；左右独立滚动互不牵动页面；点高亮→右侧选中（左侧不动）；
// 点卡片→左侧居中高亮（右侧不动）；多 Finding 弹列表；失败类重跑。
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useSessionStore } from "../stores/session";
import { useSettingsStore } from "../stores/settings";
import { useUiStore } from "../stores/ui";
import { SEVERITIES, SEVERITY_ZH } from "../domain/types";
import type { Finding } from "../domain/types";
import DocViewer from "../components/DocViewer.vue";
import FindingCard from "../components/FindingCard.vue";
import ReportView from "../components/ReportView.vue";
import { SAMPLE_DOC } from "../lib/sample";

const session = useSessionStore();
const settings = useSettingsStore();
const ui = useUiStore();

const docPaneEl = ref<HTMLElement | null>(null);
const cardsEl = ref<HTMLElement | null>(null);

const colorMap = computed<Record<string, string>>(() => {
  const m: Record<string, string> = {};
  for (const c of settings.categories) m[c.id] = c.color ?? "var(--gray)";
  return m;
});
const catName = (id: string) => settings.categoryById(id)?.name ?? id;

// ---- 分栏拖动（宽度持久化，spec: 双栏布局与独立滚动）----
const splitPercent = computed(() => settings.ui.splitPercent ?? 60);
const dragging = ref(false);
/** 拖动中的 window 监听器：仅mouseup 正常移除；组件卸载时由 onBeforeUnmount 兜底，防泄漏。 */
let dragMove: ((ev: MouseEvent) => void) | null = null;
let dragUp: (() => void) | null = null;
function onDividerDown(e: MouseEvent) {
  e.preventDefault();
  dragging.value = true;
  const move = (ev: MouseEvent) => {
    const host = docPaneEl.value?.parentElement;
    if (!host) return;
    const rect = host.getBoundingClientRect();
    const pct = ((ev.clientX - rect.left) / rect.width) * 100;
    void settings.setSplitPercent(Math.min(85, Math.max(20, pct)));
  };
  const up = () => {
    dragging.value = false;
    window.removeEventListener("mousemove", move);
    window.removeEventListener("mouseup", up);
    dragMove = null;
    dragUp = null;
  };
  dragMove = move;
  dragUp = up;
  window.addEventListener("mousemove", move);
  window.addEventListener("mouseup", up);
}
onBeforeUnmount(() => {
  if (dragMove) window.removeEventListener("mousemove", dragMove);
  if (dragUp) window.removeEventListener("mouseup", dragUp);
  dragMove = null;
  dragUp = null;
});

// ---- 运行状态条（spec: 运行状态展示）----
const STATUS_CLS: Record<string, string> = { completed: "ok", running: "run", failed: "fail" };

const sessionBadgeClass = computed(() => session.status);
const runProgress = computed(() => {
  const rs = session.runList;
  if (!rs.length) return "—";
  const done = rs.filter((r) => r.status === "completed" || r.status === "failed").length;
  return `${done}/${rs.length}`;
});
const statusText = computed(
  () =>
    ({
      idle: "IDLE",
      running: "RUNNING",
      completed: "COMPLETED",
      partial_failed: "PARTIAL FAILED",
      failed: "FAILED",
    })[session.status],
);

// ---- 筛选（Category × Severity 交集，spec: 双筛选）----
const activeCats = computed(() => {
  const ids = new Set<string>([
    ...Object.values(session.runs).map((r) => r.categoryId),
    ...session.findings.map((f) => f.categoryId),
  ]);
  return [...ids].map((id) => settings.categoryById(id)).filter((c): c is NonNullable<typeof c> => !!c);
});
const filteredFindings = computed(() =>
  session.findings.filter(
    (f) =>
      (ui.filterCategory === "all" || f.categoryId === ui.filterCategory) &&
      (ui.filterSeverity === "all" || f.severity === ui.filterSeverity),
  ),
);
const catCount = (id: string) => session.findings.filter((f) => f.categoryId === id).length;

// ---- 双向定位（spec: 高亮与双向定位）----
/** 平滑滚动到容器目标位置；环境不执行平滑动画时（旧 WKWebView 等）退避为直接定位。 */
function smoothScrollTop(container: HTMLElement, top: number) {
  const before = container.scrollTop;
  container.scrollTo({ top, behavior: "smooth" });
  window.setTimeout(() => {
    if (Math.abs(container.scrollTop - before) < 1) {
      container.scrollTo({ top, behavior: "auto" });
    }
  }, 120);
}

/** 将 target 滚动到容器视觉中心（仅容器内滚动，不影响页面与其他栏）。 */
function scrollCenter(container: HTMLElement, target: Element) {
  const tr = target.getBoundingClientRect();
  const cr = container.getBoundingClientRect();
  smoothScrollTop(container, container.scrollTop + (tr.top + tr.height / 2 - (cr.top + cr.height / 2)));
}

async function onHighlightClick(ids: string[], anchorEl: HTMLElement) {
  if (ids.length > 1) {
    showPopover(anchorEl, ids);
    return;
  }
  await locateRight(ids[0]);
}

/** 点高亮 → 右侧面板内滚动选中卡片；左侧与页面滚动位置不变。 */
async function locateRight(findingId: string) {
  ui.setSideTab("findings");
  ui.selectFinding(findingId);
  await nextTick();
  const el = cardsEl.value?.querySelector(`[data-fid="${findingId}"]`);
  if (el && cardsEl.value) scrollCenter(cardsEl.value, el);
}

let popState = ref<{ x: number; y: number; ids: string[] } | null>(null);
function showPopover(anchorEl: HTMLElement, ids: string[]) {
  const r = anchorEl.getBoundingClientRect();
  popState.value = {
    x: Math.min(window.innerWidth - 260, r.left),
    y: Math.min(window.innerHeight - 160, r.bottom + 6),
    ids,
  };
}
function popItemLabel(f: Finding) {
  return `${catName(f.categoryId)} · ${f.title}`;
}
function hidePopover() {
  popState.value = null;
}
onMounted(() => window.addEventListener("click", hidePopover));
onBeforeUnmount(() => window.removeEventListener("click", hidePopover));

/** 点卡片 → 左侧面板内滚动到对应原文并居中；右侧与页面滚动位置不变。 */
async function onCardSelect(findingId: string) {
  ui.selectFinding(findingId);
  const f = session.findings.find((x) => x.id === findingId);
  await nextTick();
  if (!f || !f.blockId || !docPaneEl.value) return;
  const target = docPaneEl.value.querySelector(`[data-block-id="${f.blockId}"]`);
  if (!target) return;
  scrollCenter(docPaneEl.value, target);
}

/** 报告回跳（spec: review-report 报告内回跳）。 */
async function onReportJump(findingId: string) {
  await onCardSelect(findingId);
}

// ---- hover 双向临时强调（多命中位置不强调单一卡片）----
function onDocHover(ids: string[] | null) {
  ui.hoverFindingId = ids && ids.length === 1 ? ids[0] : null;
}
function onCardHover(id: string | null) {
  ui.hoverFindingId = id;
}

// ---- 空态与加载反馈（spec: 加载与空状态反馈）----
const runningCats = computed(() =>
  Object.values(session.runs).filter((r) => r.status === "running"),
);
const emptyText = "本次 Review 未发现该类别下的明显问题。";

const progressLine = (categoryId: string) => {
  const c = settings.categoryById(categoryId);
  const run = session.runs[categoryId];
  if (!run) return "";
  if (run.status === "running")
    return run.degraded ? "正在基于文档结构分析……" : `正在分析全文${c?.name ?? ""}……`;
  if (run.status === "pending") return "等待中……";
  return "";
};

// ---- 顶部操作 ----
async function rerunAll() {
  const text = session.document?.text;
  if (!text) return;
  const ids = session.session?.selectedCategoryIds ?? [];
  await session.startReview(text, ids);
}
function viewReport() {
  ui.setSideTab("report");
}
async function clearAndNew() {
  await session.clearAndNew();
  ui.go("new");
}

// 自动滚到选中卡片（从报告回跳等入口）
watch(
  () => ui.selectedFindingId,
  async (id) => {
    if (id && ui.sideTab === "findings") {
      await nextTick();
      const el = cardsEl.value?.querySelector(`[data-fid="${id}"]`);
      if (el && cardsEl.value) scrollCenter(cardsEl.value, el);
    }
  },
);

void SAMPLE_DOC;
</script>

<template>
  <section class="page page-ws on">
    <!-- 恢复提示条（spec: app-persistence 恢复最近一次 Review） -->
    <div v-if="session.showRestoreBanner" class="restore-banner">
      <span>↩ 已恢复最近一次 Review 结果（应用重启不丢数据）</span>
      <button @click="clearAndNew">清除并新建</button>
      <button @click="session.showRestoreBanner = false">继续查看</button>
    </div>

    <!-- 状态栏 -->
    <div class="ws-statusbar">
      <span class="ws-stat">文档字数<b>{{ session.wordCount }}</b></span>
      <span class="ws-stat">已选类别<b>{{ session.session?.selectedCategoryIds.length ?? 0 }}</b></span>
      <span class="ws-stat">类别进度<b>{{ runProgress }}</b></span>
      <span class="ws-stat">批注<b>{{ session.findings.length }}</b></span>
      <span class="badge" :class="sessionBadgeClass">{{ statusText }}</span>
      <div class="ws-actions">
        <button class="mini" :disabled="session.isRunning" @click="rerunAll">↻ 重新分析</button>
        <button class="mini primary" :disabled="!session.report" @click="viewReport">查看报告</button>
        <button class="mini" @click="ui.go('settings')">设置</button>
      </div>
    </div>

    <!-- 类别状态条（逐类状态与计数 + 失败重跑） -->
    <div class="runstrip">
      <div v-for="run in session.runList" :key="run.categoryId" class="runcell">
        <div class="rc-top">
          <span class="csq" :style="{ background: colorMap[run.categoryId] }"></span>
          <b>{{ catName(run.categoryId) }}</b>
        </div>
        <div class="rc-status" :class="STATUS_CLS[run.status]">
          <template v-if="run.status === 'completed'">完成 · {{ catCount(run.categoryId) }}</template>
          <template v-else-if="run.status === 'running'">{{ progressLine(run.categoryId) }}</template>
          <template v-else-if="run.status === 'pending'">等待</template>
          <template v-else>失败</template>
        </div>
        <div v-if="run.error" class="rc-status fail" style="min-height: unset; white-space: normal">
          {{ run.error }}
        </div>
        <button v-if="run.status === 'failed'" class="mini rc-retry" @click="session.rerunCategory(run.categoryId)">
          ↻ 重跑该类
        </button>
      </div>
    </div>

    <!-- 双栏 -->
    <div class="ws-main">
      <div ref="docPaneEl" class="docpane" :style="{ flex: `0 0 ${splitPercent}%` }">
        <span class="divider-hint">DOC · 只读</span>
        <DocViewer
          v-if="session.document"
          :blocks="session.document.blocks"
          :findings="session.findings"
          :color-map="colorMap"
          :selected-finding-id="ui.selectedFindingId"
          :hover-finding-id="ui.hoverFindingId"
          @highlight-click="onHighlightClick"
          @highlight-hover="onDocHover"
        />
        <div v-else class="ws-empty">
          <h3>还没有进行审阅</h3>
          <p>回到「新建审阅」粘贴文稿并选择类别后开始。原文在此只读展示，点击批注可定位到对应原文位置。</p>
        </div>
      </div>

      <div class="divider" title="拖动调整分栏（宽度会被保存）" @mousedown="onDividerDown"></div>

      <div ref="sidePaneEl" class="sidepane">
        <div class="side-tabs">
          <div class="side-tab" :class="{ on: ui.sideTab === 'findings' }" @click="ui.setSideTab('findings')">
            批注 FINDINGS<span class="tn">{{ session.findings.length }}</span>
          </div>
          <div class="side-tab" :class="{ on: ui.sideTab === 'report', disabled: !session.report }" @click="session.report && ui.setSideTab('report')">
            报告 REPORT
          </div>
        </div>

        <template v-if="ui.sideTab === 'findings'">
          <div class="filters">
            <div class="frow">
              <span class="microlabel">类别</span>
              <span class="fchip" :class="{ on: ui.filterCategory === 'all' }" @click="ui.setFilterCategory('all')">全部</span>
              <span
                v-for="c in activeCats"
                :key="c.id"
                class="fchip"
                :class="{ on: ui.filterCategory === c.id }"
                @click="ui.setFilterCategory(c.id)"
              >{{ c.name }}<span class="cnt">{{ catCount(c.id) }}</span></span>
            </div>
            <div class="frow">
              <span class="microlabel">严重度</span>
              <span class="fchip" :class="{ on: ui.filterSeverity === 'all' }" @click="ui.setFilterSeverity('all')">全部</span>
              <span
                v-for="s in SEVERITIES"
                :key="s"
                class="fchip"
                :class="{ on: ui.filterSeverity === s }"
                @click="ui.setFilterSeverity(s)"
              >{{ SEVERITY_ZH[s] }}</span>
            </div>
          </div>
          <div ref="cardsEl" class="cards">
            <FindingCard
              v-for="(f, idx) in filteredFindings"
              :key="f.id"
              :data-fid="f.id"
              :style="{ '--i': idx }"
              :finding="f"
              :category-name="catName(f.categoryId)"
              :category-color="colorMap[f.categoryId]"
              :selected="ui.selectedFindingId === f.id"
              :hovered="ui.hoverFindingId === f.id"
              @select="onCardSelect"
              @hover="onCardHover"
            />
            <div
              v-if="filteredFindings.length === 0"
              class="ws-empty"
              style="padding: 40px 10px"
            >
              <h3 style="font-size: 14px">{{ emptyText }}</h3>
              <p v-if="runningCats.length">分析仍在进行：{{ runningCats.map((r) => catName(r.categoryId)).join("、") }} 完成后结果会立即出现。</p>
            </div>
          </div>
        </template>

        <template v-else-if="session.report">
          <ReportView
            :report="session.report"
            :findings="session.findings"
            :categories="settings.categories"
            :color-map="colorMap"
            @jump="onReportJump"
            @open-findings="ui.setSideTab('findings')"
          />
        </template>
      </div>
    </div>

    <!-- 多 Finding 位置弹出列表 -->
    <div
      v-if="popState"
      class="pop"
      :class="{ show: !!popState }"
      :style="{ left: popState.x + 'px', top: popState.y + 'px' }"
      @click.stop
    >
      <div class="pop-h">该文本对应 {{ popState.ids.length }} 个 FINDING</div>
      <div
        v-for="id in popState.ids"
        :key="id"
        class="pop-item"
        @click="hidePopover(); locateRight(id)"
      >
        <span :style="{ width: '8px', height: '8px', background: colorMap[session.findings.find((f) => f.id === id)?.categoryId ?? ''] }"></span>
        <b style="flex: 1">{{ popItemLabel(session.findings.find((f) => f.id === id)!) }}</b>
        <span class="sev" :class="session.findings.find((f) => f.id === id)?.severity" style="font-size: 9px">
          {{ SEVERITY_ZH[session.findings.find((f) => f.id === id)!.severity] }}
        </span>
      </div>
    </div>
  </section>
</template>
