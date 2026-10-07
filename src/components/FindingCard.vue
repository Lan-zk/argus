<script setup lang="ts">
// Finding 卡片（spec: review-ui Finding 卡片内容 / PRD §59）。
// 七要素：Category、Severity、标题、原文引用、问题、原因、修改建议。无任何状态按钮。
// spec: finding-anchor-spans —— 行范围主锚显示 Lx–Ly；引用锚列出位置，未定位引用如实标注。
import { computed } from "vue";
import type { Finding } from "../domain/types";
import { SEVERITY_ZH } from "../domain/types";

const props = defineProps<{
  finding: Finding;
  categoryName: string;
  categoryColor: string;
  selected?: boolean;
  hovered?: boolean;
}>();

const emit = defineEmits<{
  (e: "select", id: string): void;
  (e: "hover", id: string | null): void;
}>();

const sevZh = computed(() => SEVERITY_ZH[props.finding.severity]);

const primary = computed(() => props.finding.anchors.find((a) => a.role === "primary") ?? props.finding.anchors[0]);

const lineLabel = computed(() => {
  const p = primary.value;
  if (p?.scope === "range" && p.fromLine !== undefined && p.toLine !== undefined) {
    return p.fromLine === p.toLine ? `L${p.fromLine}` : `L${p.fromLine}–L${p.toLine}`;
  }
  return props.finding.line ? `L${props.finding.line}` : "";
});

const refAnchors = computed(() => props.finding.anchors.filter((a) => a.role === "ref"));
</script>

<template>
  <article
    class="card"
    :class="{ sel: selected, hov: hovered, unanchored: finding.anchorStatus === 'unanchored' }"
    :style="{ '--cc': categoryColor }"
    role="button"
    :tabindex="0"
    :aria-pressed="selected"
    @click="emit('select', finding.id)"
    @keydown.enter.prevent="emit('select', finding.id)"
    @keydown.space.prevent="emit('select', finding.id)"
    @mouseenter="emit('hover', finding.id)"
    @mouseleave="emit('hover', null)"
  >
    <div class="card-head">
      <span class="cat-tag"><span class="csq"></span>{{ categoryName }}</span>
      <span class="sev" :class="finding.severity">{{ sevZh }}</span>
      <span v-if="finding.anchorStatus === 'unanchored'" class="unb">未定位</span>
      <span v-if="lineLabel" class="bidref">{{ lineLabel }}</span>
    </div>
    <h4>{{ finding.title }}</h4>
    <div class="quote">{{ finding.quote }}</div>
    <div v-if="refAnchors.length" class="refrow">
      <span
        v-for="(a, i) in refAnchors"
        :key="i"
        class="fref"
        :class="{ lost: a.anchorStatus !== 'anchored' }"
      >↩ {{ a.anchorStatus === "anchored" && a.line ? `L${a.line} 引用` : "引用未定位" }}</span>
    </div>
    <div class="fsec">
      <div class="fl">问题</div>
      <p>{{ finding.problem }}</p>
    </div>
    <div class="fsec">
      <div class="fl">为什么</div>
      <p>{{ finding.reason }}</p>
    </div>
    <div class="fsec">
      <div class="fl">建议</div>
      <p>{{ finding.suggestion }}</p>
    </div>
  </article>
</template>
