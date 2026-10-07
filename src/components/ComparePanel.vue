<script setup lang="ts">
// 对比面板（spec: review-ui 轮次切换与对比面板）：「本轮 vs 上轮」。
// 上轮问题去向（L1·确定性：已修改/未动/待确认）+ 本轮构成（L2·概率性：疑似遗留附置信度/新问题）
// + 疑似遗留两轮说法并排 + 配置变更「仅供参考」提示。首轮无上轮 → 空态说明。
import { computed, onMounted, ref, watch } from "vue";
import { useSessionStore } from "../stores/session";
import { useSettingsStore } from "../stores/settings";
import { useUiStore } from "../stores/ui";
import { getRepo } from "../lib/repo";
import type { FindingLinkRow, FindingRow } from "../lib/repo/types";
import { SEVERITY_ZH } from "../domain/types";
import { onColorText } from "../lib/contrast";

const session = useSessionStore();
const settings = useSettingsStore();
const ui = useUiStore();

const links = ref<FindingLinkRow[]>([]);
const prevFindings = ref<FindingRow[]>([]);
const hasPrev = ref(false);
const expandedId = ref<string | null>(null);
/** 跨轮输入方式是否不同（spec: document-import 跨轮输入一致性提示）。 */
const inputKindMismatch = ref(false);

const l1Links = computed(() => links.value.filter((l) => l.linkType !== "recurring"));
const l1Counts = computed(() => {
  const c = { unresolved: 0, edited: 0, ambiguous: 0 } as Record<string, number>;
  for (const l of l1Links.value) c[l.linkType] = (c[l.linkType] ?? 0) + 1;
  return c;
});
const l1Label: Record<string, string> = { unresolved: "未动", edited: "已修改", ambiguous: "待确认" };
const l1Note: Record<string, string> = {
  unresolved: "引用文本原样存在",
  edited: "引用文本已不存在",
  ambiguous: "周边文字变动，无法确定",
};
const visibleL1 = ref<string | null>(null);
const l1Items = computed(() =>
  visibleL1.value ? l1Links.value.filter((l) => l.linkType === visibleL1.value) : [],
);

const recurringLinks = computed(() => links.value.filter((l) => l.linkType === "recurring"));
const newCount = computed(() => {
  const linked = new Set(recurringLinks.value.map((l) => l.currFindingId).filter(Boolean));
  return session.findings.length - linked.size;
});

function prevFinding(id: string): FindingRow | undefined {
  return prevFindings.value.find((f) => f.id === id);
}
function currFinding(id?: string) {
  return id ? session.findings.find((f) => f.id === id) : undefined;
}
const catName = (id: string) => settings.categoryById(id)?.name ?? id;
const colorOf = (id: string) => settings.categoryById(id)?.color ?? "var(--gray)";

async function load() {
  const plan = session.plan;
  if (!plan) return;
  const repo = getRepo();
  const rounds = await repo.listRounds(plan.projectId);
  const prev = rounds.find((r) => r.number === plan.number - 1);
  hasPrev.value = !!prev;
  if (prev) {
    const snap = await repo.loadRound(prev.id);
    prevFindings.value = snap?.findings ?? [];
    // 一致性提示数据位：一轮粘贴、一轮导入 → 提示对比噪声可能变大
    const currSnap = await repo.loadRound(plan.roundId);
    const kindOf = (m: { kind: string } | undefined) => (m && m.kind !== "paste" ? "import" : "paste");
    inputKindMismatch.value =
      !!currSnap?.document.sourceMeta &&
      kindOf(currSnap.document.sourceMeta) !== kindOf(snap?.document.sourceMeta);
  } else {
    prevFindings.value = [];
    inputKindMismatch.value = false;
  }
  links.value = await repo.listLinksByRound(plan.roundId);
}

onMounted(load);
watch(
  () => session.plan?.roundId,
  () => {
    expandedId.value = null;
    visibleL1.value = null;
    void load();
  },
);

/** 跳转到本轮对应 Finding 卡片（批注页签滚动定位）。 */
function goto(findingId?: string) {
  if (!findingId) return;
  ui.selectFinding(findingId);
  ui.setSideTab("findings");
}
</script>

<template>
  <div class="cmp-panel">
    <!-- 配置变更提示（spec: 新一轮配置沿用） -->
    <div v-if="session.configChanged" class="cfgwarn">
      ⚠ 配置已变更，对比仅供参考 —— 本轮与上一轮使用的类别提示词版本或模型不同，差异可能来自配置而非文档修改。
    </div>

    <!-- 跨轮输入方式不同（spec: document-import 跨轮输入一致性提示） -->
    <div v-if="inputKindMismatch" class="cfgwarn" data-test="input-kind-mismatch">
      ⚠ 两轮输入方式不同（一轮粘贴、一轮文件导入）—— 导入提取与粘贴文本存在格式差异，对比结果可能受此影响。
    </div>

    <div v-if="!hasPrev" class="cmp-empty">
      这是项目的第一轮审阅，还没有上一轮可对比。<br />开新一轮后，这里会显示两轮之间的问题去向与遗留情况。
    </div>

    <template v-else>
      <!-- 判定图例（评审遗留：核心概念首次出现无解释入口） -->
      <div class="cmp-legend">
        <span class="tag certain">确定性判定</span>基于原文文本比对，机器核对、不依赖模型。
        <span class="tag prob">概率性判定</span>由模型比对两轮说法给出，附置信度、仅供参考。
      </div>
      <!-- 上轮去向：L1 确定性判定 -->
      <div class="cmp-sec">
        <div class="sh">
          <b>上一轮 {{ l1Links.length }} 个问题的去向</b>
          <span class="tag certain">确定性判定</span>
        </div>
        <div class="bars">
          <button
            v-for="k in ['edited', 'unresolved', 'ambiguous']"
            :key="k"
            class="bar"
            :class="{ on: visibleL1 === k }"
            @click="visibleL1 = visibleL1 === k ? null : k"
          >
            <span class="n" :data-k="k">{{ l1Counts[k] ?? 0 }}</span>
            <span class="t">{{ l1Label[k] }}</span>
            <span class="d">{{ l1Note[k] }}</span>
          </button>
        </div>
        <div v-if="visibleL1" class="l1-items">
          <div v-for="l in l1Items" :key="l.prevFindingId" class="l1-item">
            <span class="st" :data-k="visibleL1">{{ l1Label[visibleL1] }}</span>
            <span class="q">{{ prevFinding(l.prevFindingId)?.title ?? l.prevFindingId }}</span>
          </div>
          <p v-if="l1Items.length === 0" class="l1-none">该类无问题</p>
        </div>
      </div>

      <!-- 本轮构成：L2 概率性判定 -->
      <div class="cmp-sec">
        <div class="sh">
          <b>本轮 {{ session.findings.length }} 个发现的构成</b>
          <span class="tag prob">概率性判定</span>
        </div>
        <div class="bars two">
          <div class="bar static">
            <span class="n ochre">{{ recurringLinks.length }}</span>
            <span class="t">疑似遗留</span>
            <span class="d">附置信度 · 可两轮并排</span>
          </div>
          <div class="bar static">
            <span class="n">{{ newCount }}</span>
            <span class="t">新问题</span>
            <span class="d">本轮新出现</span>
          </div>
        </div>
      </div>

      <!-- 疑似遗留卡片 + 两轮并排 -->
      <div v-if="recurringLinks.length" class="cmp-sec">
        <div class="sh"><b>疑似遗留</b><span class="hint">点卡片展开两轮说法并排</span></div>
        <div v-for="l in recurringLinks" :key="`${l.prevFindingId}-${l.currFindingId}`" class="rcard">
          <button class="rcard-head" @click="expandedId = expandedId === l.currFindingId ? null : (l.currFindingId ?? null)">
            <span
              class="cat"
              :style="{ background: colorOf(currFinding(l.currFindingId)?.categoryId ?? ''), color: onColorText(colorOf(currFinding(l.currFindingId)?.categoryId ?? '')) }"
            >
              {{ catName(currFinding(l.currFindingId)?.categoryId ?? "") }}
            </span>
            <span class="ft">{{ currFinding(l.currFindingId)?.title ?? "（本轮发现）" }}</span>
            <span class="conf">可能为同一问题 · {{ Math.round((l.confidence ?? 0) * 100) }}%</span>
          </button>
          <div class="confbar"><i :style="{ width: `${Math.round((l.confidence ?? 0) * 100)}%` }"></i></div>
          <div v-if="expandedId === l.currFindingId" class="sbs">
            <div class="sbs-col">
              <span class="rt">上一轮</span>
              <b>{{ prevFinding(l.prevFindingId)?.title ?? "（已删除）" }}</b>
              <span class="lbl">引用</span>
              <blockquote>{{ prevFinding(l.prevFindingId)?.quote }}</blockquote>
              <span class="lbl">建议</span>
              <p>{{ prevFinding(l.prevFindingId)?.suggestion }}</p>
            </div>
            <div class="sbs-col">
              <span class="rt">本轮（{{ SEVERITY_ZH[currFinding(l.currFindingId)?.severity ?? "medium"] }}）</span>
              <b>{{ currFinding(l.currFindingId)?.title }}</b>
              <span class="lbl">引用</span>
              <blockquote>{{ currFinding(l.currFindingId)?.quote }}</blockquote>
              <span class="lbl">建议</span>
              <p>{{ currFinding(l.currFindingId)?.suggestion }}</p>
            </div>
          </div>
          <div class="rcard-foot">
            <button class="mini" @click="goto(l.currFindingId)">定位到批注 →</button>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
/* P1-1：右栏三页签统一内容节奏——栏底 80px / 节间距 24px（与批注卡列表、报告一致） */
.cmp-panel {
  padding: 18px 18px 80px;
  overflow-y: auto;
  height: 100%;
  animation: pagein 0.18s var(--ease-out-quint);
}
.cfgwarn {
  border: 2px solid var(--ochre);
  background: color-mix(in srgb, var(--ochre) 7%, transparent);
  padding: 10px 14px;
  font-size: 12px;
  color: var(--ochre);
  line-height: 1.7;
  margin-bottom: 16px;
}
.cmp-empty {
  color: var(--ink50);
  font-size: 13px;
  line-height: 2;
  padding: 28px 10px;
  text-align: center;
}
.cmp-legend {
  font-size: 11px;
  color: var(--ink50);
  line-height: 1.8;
  margin-bottom: 14px;
}
.cmp-legend .tag {
  margin-right: 5px;
}
.cmp-sec {
  margin-bottom: 24px;
}
.sh {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin-bottom: 10px;
}
.sh b {
  font-size: 13.5px;
}
.sh .hint {
  font-size: 11px;
  color: var(--ink50);
  margin-left: auto;
}
.tag {
  font-size: 10px;
  border: 1px solid currentColor;
  padding: 1px 6px;
}
.tag.certain {
  color: var(--ok);
}
.tag.prob {
  color: var(--ochre);
}
.bars {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 1px;
  background: var(--ink15);
  border: 1px solid var(--ink15);
}
.bars.two {
  grid-template-columns: repeat(2, 1fr);
}
/* P1-3：显式归零圆角——否则 Apple 的全局 button 11px 圆角会把 1px 拼缝马赛克的格子磨圆漏底 */
.bar {
  background: var(--card);
  padding: 12px 8px;
  text-align: center;
  border: none;
  border-radius: 0;
  cursor: pointer;
  font-family: inherit;
}
.bar.static {
  cursor: default;
}
.bar.on {
  background: var(--paper2);
  box-shadow: inset 0 0 0 2px var(--ink);
}
.bar .n {
  display: block;
  font-family: var(--mono);
  font-size: 21px;
  font-weight: 700;
}
.bar .n[data-k="edited"] {
  color: var(--ok);
}
/* 疑似遗留计数：与 ambiguous 同语义（待确认系），ochre 而非绿色 */
.bar .n.ochre {
  color: var(--ochre);
}
.bar .n[data-k="unresolved"] {
  color: var(--danger);
}
.bar .n[data-k="ambiguous"] {
  color: var(--ochre);
}
.bar .t {
  display: block;
  font-size: 10.5px;
  color: var(--ink50);
  margin-top: 2px;
}
.bar .d {
  display: block;
  font-size: 10px;
  color: var(--ink50);
  margin-top: 3px;
}
.l1-items {
  border: var(--hair);
  border-top: none;
  background: var(--card);
  max-height: 160px;
  overflow-y: auto;
}
.l1-item {
  display: flex;
  gap: 10px;
  padding: 8px 12px;
  font-size: 12px;
  border-bottom: var(--hair);
  align-items: baseline;
}
.l1-item:last-child {
  border-bottom: none;
}
.l1-item .st {
  font-family: var(--mono);
  font-size: 10px;
  flex-shrink: 0;
  width: 52px;
}
.l1-item .st[data-k="edited"] {
  color: var(--ok);
}
.l1-item .st[data-k="unresolved"] {
  color: var(--danger);
}
.l1-item .st[data-k="ambiguous"] {
  color: var(--ochre);
}
.l1-item .q {
  color: var(--ink70);
}
.l1-none {
  font-size: 11px;
  color: var(--ink50);
  padding: 8px 12px;
}
.rcard {
  border: var(--hair);
  background: var(--card);
  margin-bottom: 12px;
}
.rcard-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  width: 100%;
  background: none;
  border: none;
  border-radius: 0;
  cursor: pointer;
  font-family: inherit;
  text-align: left;
}
.rcard-head .cat {
  font-size: 10px;
  font-weight: 700;
  color: var(--on-accent);
  padding: 2px 8px;
  flex-shrink: 0;
}
.rcard-head .ft {
  font-size: 12.5px;
  font-weight: 700;
  flex: 1;
  color: var(--ink);
}
.conf {
  font-size: 10px;
  color: var(--ink50);
  flex-shrink: 0;
}
.confbar {
  height: 3px;
  background: var(--ink15);
  margin: 0 12px 10px;
}
.confbar i {
  display: block;
  height: 100%;
  background: var(--ochre);
}
.sbs {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0;
  border-top: 2px solid var(--ink);
}
/* P2-15：Apple 下 2px 墨线降发丝线（与其余结构线降级一致） */
[data-theme^="apple"] .cmp-panel .sbs {
  border-top: 1px solid var(--ink15);
}
.sbs-col {
  padding: 12px;
  font-size: 11.5px;
  line-height: 1.7;
}
.sbs-col:first-child {
  border-right: var(--hair);
  background: var(--paper);
}
/* 轮次标记是中性标签，非危险语义（Red Means Stop）；中文短语不用 mono */
.sbs-col .rt {
  font-size: 10px;
  letter-spacing: 0.1em;
  color: var(--ink50);
  display: block;
  margin-bottom: 8px;
}
.sbs-col b {
  font-size: 12px;
  display: block;
  margin-bottom: 6px;
}
.sbs-col .lbl {
  font-size: 10px;
  letter-spacing: 0.12em;
  color: var(--ink50);
  display: block;
  margin: 8px 0 2px;
}
.sbs-col blockquote {
  background: var(--paper2);
  padding: 6px 8px;
  color: var(--ink70);
  font-size: 11px;
  margin: 0;
}
.sbs-col p {
  margin: 0;
  color: var(--ink70);
}
.rcard-foot {
  padding: 0 12px 10px;
  text-align: right;
}
.rcard-foot .mini {
  font-size: 11px;
  padding: 3px 10px;
}
</style>
