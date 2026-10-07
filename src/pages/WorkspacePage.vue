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
import ComparePanel from "../components/ComparePanel.vue";
import { SAMPLE_DOC } from "../lib/sample";
import { useProjectsStore } from "../stores/projects";
import { getRepo } from "../lib/repo";

const session = useSessionStore();
const settings = useSettingsStore();
const ui = useUiStore();
const projects = useProjectsStore();
// 删除本轮改为软删+撤销（deletion store），不再使用武装态

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
/** 报告页签 = 阅读态：文档栏临时收窄给报告让版面（不落盘，切回批注/对比即恢复用户分栏偏好）。 */
const docFlex = computed(() => (ui.sideTab === "report" ? 32 : splitPercent.value));
const dragging = ref(false);
/** 拖动中的 window 监听器：仅mouseup 正常移除；组件卸载时由 onBeforeUnmount 兜底，防泄漏。 */
let dragMove: ((ev: MouseEvent) => void) | null = null;
let dragUp: (() => void) | null = null;
function onDividerDown(e: MouseEvent) {
  if (ui.sideTab === "report") return; // 报告版面用固定分栏，拖拽只在批注/对比页签生效
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
const statusText = computed(
  () =>
    ({
      idle: "未开始",
      running: "审阅中",
      completed: "已完成",
      partial_failed: "部分失败",
      failed: "失败",
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
onBeforeUnmount(() => {
  window.removeEventListener("click", hidePopover);
  if (reportFlashTimer) clearTimeout(reportFlashTimer);
});

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

// delight：镜头动词文案——每个审阅镜头用自己的编辑动作报进度（区分「哪个镜头在干活」，编辑部口吻）
const LENS_VERB: Record<string, string> = {
  logic: "正在推演论证链",
  thesis: "正在核对核心主张",
  argument: "正在查验论据",
  rhetoric: "正在掂量措辞",
  structure: "正在检查篇章骨架",
  clarity: "正在通读句法",
  speech: "正在试讲",
};
const progressLine = (categoryId: string) => {
  const c = settings.categoryById(categoryId);
  const run = session.runs[categoryId];
  if (!run) return "";
  if (run.status === "running")
    return run.degraded ? "正在基于文档结构分析……" : `${LENS_VERB[categoryId] ?? `正在以「${c?.name ?? "该视角"}」通读`}……`;
  if (run.status === "pending") return "等待中……";
  return "";
};

// delight：全镜头完成的「干净稿件」时刻——零批注即排字工的交付瞬间
const allClean = computed(
  () =>
    session.findings.length === 0 &&
    !session.isRunning &&
    session.runList.length > 0 &&
    session.runList.every((r) => r.status === "completed"),
);

// delight：报告就绪的一次性提示——「报告」页签闪一次 accent（长审阅的关键收束点）
const reportReadyFlash = ref(false);
let reportFlashTimer: ReturnType<typeof setTimeout> | null = null;
watch(
  () => session.report,
  (r, prev) => {
    if (r && !prev) {
      reportReadyFlash.value = true;
      if (reportFlashTimer) clearTimeout(reportFlashTimer);
      reportFlashTimer = setTimeout(() => (reportReadyFlash.value = false), 900);
    }
  },
);

// ---- 顶部操作 ----
// 「开新一轮」入口在轮次条（不覆盖既有轮次，spec: review-versioning 轮次与不可变快照）
async function switchRound(roundId: string) {
  if (session.isRunning || roundId === projects.activeRoundId) return;
  await projects.setActiveRound(roundId);
  const snap = await getRepo().loadRound(roundId);
  if (snap) await session.restoreRound(snap);
}
async function deleteRound() {
  if (!projects.activeRoundId || session.isRunning) return;
  await projects.requestDeleteRound(projects.activeRoundId); // 软删：8 秒内可撤销
}
function viewReport() {
  ui.setSideTab("report");
}

// 键盘：1/2/3 切右栏页签；j/k 在批注卡片间移动（输入控件内不触发）
function onWorkspaceKey(e: KeyboardEvent) {
  const t = e.target as HTMLElement;
  if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === "1") ui.setSideTab("findings");
  else if (e.key === "2" && session.report) ui.setSideTab("report");
  else if (e.key === "3") ui.setSideTab("compare");
  else if ((e.key === "j" || e.key === "k") && ui.sideTab === "findings" && filteredFindings.value.length > 0) {
    const ids = filteredFindings.value.map((f) => f.id);
    const cur = ids.indexOf(ui.selectedFindingId ?? "");
    const next = e.key === "j" ? Math.min(cur + 1, ids.length - 1) : Math.max(cur - 1, 0);
    ui.selectFinding(ids[cur < 0 ? 0 : next]);
  }
}
onMounted(() => window.addEventListener("keydown", onWorkspaceKey));
onBeforeUnmount(() => window.removeEventListener("keydown", onWorkspaceKey));

// 轮次摘要：该轮相对上轮的 L1 去向（回溯不靠记忆——评审启发式问题 1）
const roundSummaries = ref<Record<string, string>>({});

/** 当前轮次来源标签（spec: document-import 轮次显示来源）：导入轮显示文件名与导入时间，粘贴不显示。 */
const roundSourceLabel = computed(() => {
  const src = session.documentSource;
  if (!src || src.kind === "paste") return "";
  const t = src.importedAt.slice(5, 16).replace("T", " ");
  return `${src.filename} · ${t}`;
});
async function loadRoundSummaries() {
  const repo = getRepo();
  const out: Record<string, string> = {};
  for (const r of projects.activeRounds) {
    if (r.number < 2) continue;
    const links = await repo.listLinksByRound(r.id);
    const l1 = links.filter((l) => l.linkType !== "recurring");
    if (l1.length === 0) continue;
    const edited = l1.filter((l) => l.linkType === "edited").length;
    out[r.id] = `上轮 ${l1.length} 个问题 · ${edited} 已修改`;
  }
  roundSummaries.value = out;
}
watch(
  () => projects.activeRounds.length,
  () => void loadRoundSummaries(),
  { immediate: true },
);

// 活动轮被软删/切换后：加载回退轮快照（由 projects store 更新 activeRoundId）
watch(
  () => projects.activeRoundId,
  async (rid) => {
    if (!rid || session.isRunning) return;
    if (session.plan?.roundId === rid) return;
    const snap = await getRepo().loadRound(rid);
    if (snap) await session.restoreRound(snap);
  },
);

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
    <!-- 轮次切换条（spec: review-versioning 轮次管理/按序号切换查看；项目名保证折叠侧栏后主区仍有上下文） -->
    <div class="roundstrip">
      <span class="ws-proj" :title="projects.activeProject?.name">{{ projects.activeProject?.name ?? "审阅" }}</span>
      <span class="microlabel">轮次</span>
      <button
        v-for="r in projects.activeRounds"
        :key="r.id"
        class="rtab"
        :class="{ on: r.id === projects.activeRoundId }"
        :disabled="session.isRunning"
        :aria-label="`第 ${r.number} 轮（${r.createdAt.slice(0, 10)}）`"
        :title="`第 ${r.number} 轮 · ${r.createdAt.slice(0, 10)}${roundSummaries[r.id] ? ' · ' + roundSummaries[r.id] : ''}${r.status === 'partial_failed' ? ' · 未完成' : ''}`"
        @click="switchRound(r.id)"
      >
        <span class="r-no">{{ r.number }}</span><span class="r-date">{{ r.createdAt.slice(5, 10) }}</span>
      </button>
      <span class="round-aux">
        <span v-if="session.roundNumber" class="round-src">
          第 {{ session.roundNumber }} 轮<template v-if="roundSummaries[projects.activeRoundId ?? '']"> · {{ roundSummaries[projects.activeRoundId ?? ''] }}</template>
          <template v-if="roundSourceLabel"> · 来源：{{ roundSourceLabel }}</template>
        </span>
        <span v-if="session.showRestoreBanner" class="round-unfinished">该轮未完成</span>
      </span>
      <span class="ws-actions">
        <button class="mini" @click="ui.goReview('new')">＋ 开新一轮</button>
        <button v-if="session.isRunning" class="mini danger" @click="session.cancelReview()">■ 取消审阅</button>
        <button v-else class="mini danger" title="删除后 8 秒内可在右下角撤销" @click="deleteRound">删除本轮</button>
      </span>
    </div>
    <!-- 恢复提示条（spec: app-persistence 恢复审阅工作区——重启回到最后轮次 MUST 有明确提示；
         附新建审阅入口：重启后想直接导入/粘贴新文稿的用户不必再找侧栏）；消失走 150ms 淡出（清理批 #7） -->
    <Transition name="fade">
      <div v-if="session.showRestoreBanner" class="restore-banner" data-test="restore-banner">
        <span>↩ 已打开上次所在轮次（应用重启不丢数据）<template v-if="session.status === 'partial_failed'"> · 该轮未完成，以下为已产出的部分结果</template></span>
        <span class="rb-actions">
          <button data-test="restore-new-review" @click="ui.goReview('new')">＋ 新建审阅</button>
          <button @click="session.showRestoreBanner = false">知道了</button>
        </span>
      </div>
    </Transition>

    <!-- 状态栏 -->
    <div class="ws-statusbar">
      <span class="ws-stat">文档字数<b>{{ session.wordCount }}</b></span>
      <span class="ws-stat">已选类别<b>{{ session.session?.selectedCategoryIds.length ?? 0 }}</b></span>
      <span class="ws-stat">批注<b>{{ session.findings.length }}</b></span>
      <span class="badge" :class="sessionBadgeClass" role="status" aria-live="polite">{{ statusText }}</span>
      <div class="ws-actions">
        <button class="mini primary" :disabled="!session.report" @click="viewReport">查看报告</button>
        <button class="mini" @click="ui.go('settings')">设置</button>
      </div>
    </div>

    <!-- 类别状态条（逐类状态与计数 + 失败重跑）。
         类别墨线（rc-ink）：状态即墨线——pending 无线 / running 色段滑行 / completed 落墨压满 / failed 断线 -->
    <div class="runstrip">
      <div
        v-for="(run, idx) in session.runList"
        :key="run.categoryId"
        class="runcell"
        :class="run.status"
        :style="{ '--i': idx }"
      >
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
        <div v-if="run.error" class="rc-status fail rc-err" :title="run.error">
          {{ run.error }}
        </div>
        <span
          class="rc-ink"
          :style="{ '--rc': colorMap[run.categoryId] }"
          aria-hidden="true"
        ></span>
        <button v-if="run.status === 'failed'" class="mini rc-retry" @click="session.rerunCategory(run.categoryId)">
          ↻ 重跑该类
        </button>
      </div>
    </div>

    <!-- 双栏 -->
    <div class="ws-main">
      <div ref="docPaneEl" class="docpane" :style="{ flex: `0 0 ${docFlex}%` }">
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
          <p>左侧选择一个审阅项目，或点「开新一轮」粘贴文稿开始。原文在此只读展示，点击批注可定位到对应原文位置。</p>
        </div>
      </div>

      <div
        class="divider"
        :class="{ off: ui.sideTab === 'report' }"
        :title="ui.sideTab === 'report' ? '报告版面下分栏固定，切回批注可拖动' : '拖动调整分栏（宽度会被保存）'"
        @mousedown="onDividerDown"
      ></div>

      <div ref="sidePaneEl" class="sidepane">
        <div class="side-tabs" role="tablist" aria-label="右侧面板">
          <button
            role="tab"
            :aria-selected="ui.sideTab === 'findings'"
            class="side-tab"
            :class="{ on: ui.sideTab === 'findings' }"
            @click="ui.setSideTab('findings')"
          >
            批注<span class="tn">{{ session.findings.length }}</span>
          </button>
          <button
            role="tab"
            :aria-selected="ui.sideTab === 'report'"
            :aria-disabled="!session.report"
            class="side-tab"
            :class="{ on: ui.sideTab === 'report', disabled: !session.report, 'report-ready': reportReadyFlash }"
            @click="session.report && ui.setSideTab('report')"
          >
            报告
          </button>
          <button
            role="tab"
            :aria-selected="ui.sideTab === 'compare'"
            class="side-tab"
            :class="{ on: ui.sideTab === 'compare' }"
            @click="ui.setSideTab('compare')"
          >
            对比<span v-if="session.roundNumber && session.roundNumber > 1" class="tn">R{{ session.roundNumber }}</span>
          </button>
        </div>

        <template v-if="ui.sideTab === 'findings'">
          <div class="filters">
            <div class="frow">
              <span class="flabel">类别</span>
              <span
                class="fchip"
                :class="{ on: ui.filterCategory === 'all' }"
                role="button"
                :tabindex="0"
                :aria-pressed="ui.filterCategory === 'all'"
                @click="ui.setFilterCategory('all')"
                @keydown.enter.prevent="ui.setFilterCategory('all')"
                @keydown.space.prevent="ui.setFilterCategory('all')"
                >全部</span>
              <span
                v-for="c in activeCats"
                :key="c.id"
                class="fchip"
                :class="{ on: ui.filterCategory === c.id }"
                role="button"
                :tabindex="0"
                :aria-pressed="ui.filterCategory === c.id"
                @click="ui.setFilterCategory(c.id)"
                @keydown.enter.prevent="ui.setFilterCategory(c.id)"
                @keydown.space.prevent="ui.setFilterCategory(c.id)"
                >{{ c.name }}<span class="cnt">{{ catCount(c.id) }}</span></span>
            </div>
            <div class="frow">
              <span class="flabel">严重度</span>
              <span
                class="fchip"
                :class="{ on: ui.filterSeverity === 'all' }"
                role="button"
                :tabindex="0"
                :aria-pressed="ui.filterSeverity === 'all'"
                @click="ui.setFilterSeverity('all')"
                @keydown.enter.prevent="ui.setFilterSeverity('all')"
                @keydown.space.prevent="ui.setFilterSeverity('all')"
                >全部</span>
              <span
                v-for="s in SEVERITIES"
                :key="s"
                class="fchip"
                :class="{ on: ui.filterSeverity === s }"
                role="button"
                :tabindex="0"
                :aria-pressed="ui.filterSeverity === s"
                @click="ui.setFilterSeverity(s)"
                @keydown.enter.prevent="ui.setFilterSeverity(s)"
                @keydown.space.prevent="ui.setFilterSeverity(s)"
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
            <div v-if="filteredFindings.length === 0" class="ws-empty compact" :class="{ clean: allClean }">
              <svg v-if="allClean" class="clean-check" viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">
                <path d="M4 12.5 10 18.5 20 6.5" />
              </svg>
              <h3>{{ allClean ? "全文通读完毕，未发现明显问题" : emptyText }}</h3>
              <p v-if="allClean">这一稿可以交付了。</p>
              <p v-else-if="runningCats.length">分析仍在进行：{{ runningCats.map((r) => catName(r.categoryId)).join("、") }} 完成后结果会立即出现。</p>
            </div>
          </div>
        </template>

        <template v-else-if="ui.sideTab === 'compare'">
          <ComparePanel />
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
        <span class="sev" :class="session.findings.find((f) => f.id === id)?.severity">
          {{ SEVERITY_ZH[session.findings.find((f) => f.id === id)!.severity] }}
        </span>
      </div>
    </div>
  </section>
</template>

<style scoped>
/* 轮次切换条（spec: review-versioning 轮次管理；评审修复：此前样式缺失） */
.roundstrip {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 28px;
  border-bottom: var(--hair);
  background: var(--card);
  flex: 0 0 auto;
  flex-wrap: wrap;
}
.ws-proj {
  font-size: 13px;
  font-weight: 600;
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-right: 4px;
}
/* delight：干净稿件的勾一次画成（stroke 描边动画，reduced-motion 下即时完成） */
.ws-empty.clean .clean-check {
  display: block;
  margin-bottom: 10px;
}
.ws-empty.clean .clean-check path {
  fill: none;
  stroke: var(--ok);
  stroke-width: 2.5;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-dasharray: 26;
  stroke-dashoffset: 26;
  animation: checkdraw 0.45s var(--ease-out-quint) 0.1s forwards;
}
@keyframes checkdraw {
  to {
    stroke-dashoffset: 0;
  }
}
/* delight：报告就绪——页签一次性 accent 闪色 */
.side-tab.report-ready {
  animation: tabready 0.5s var(--ease-out-quint);
}
@keyframes tabready {
  from {
    color: var(--accent);
    border-bottom-color: var(--accent);
  }
}
.fade-leave-active {
  transition: opacity 0.15s var(--ease-out-quint);
}
.fade-leave-to {
  opacity: 0;
}
.rtab {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
  font-family: var(--mono);
  line-height: 1.2;
  min-width: 40px;
  padding: 4px 8px;
  border: 1px solid var(--ink35);
  background: var(--card);
  color: var(--ink70);
  cursor: pointer;
  border-radius: var(--radius-sm);
}
.r-no {
  font-size: 12px;
  font-weight: 700;
}
.r-date {
  font-size: 10px;
  font-weight: 400;
  color: var(--ink50);
}
.rtab.on .r-date {
  color: var(--paper2);
}
.rtab:hover:not(:disabled) {
  border-color: var(--ink);
  color: var(--ink);
}
.rtab.on {
  background: var(--ink);
  border-color: var(--ink);
  color: var(--paper);
}
.rtab:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.round-aux {
  display: flex;
  gap: 10px;
  align-items: baseline;
}
.round-src {
  font-family: var(--mono);
  font-size: 10px;
  color: var(--ink50);
}
.round-unfinished {
  font-size: 10.5px;
  font-weight: 600;
  color: var(--ochre);
}
</style>
