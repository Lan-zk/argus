<script setup lang="ts">
// Finding 卡片（spec: review-ui Finding 卡片内容 / PRD §59）。
// 七要素：Category、Severity、标题、原文引用、问题、原因、修改建议。无任何状态按钮。
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
</script>

<template>
  <article
    class="card"
    :class="{ sel: selected, hov: hovered, unanchored: finding.anchorStatus === 'unanchored' }"
    :style="{ '--cc': categoryColor }"
    @click="emit('select', finding.id)"
    @mouseenter="emit('hover', finding.id)"
    @mouseleave="emit('hover', null)"
  >
    <div class="card-head">
      <span class="cat-tag"><span class="csq"></span>{{ categoryName }}</span>
      <span class="sev" :class="finding.severity">{{ sevZh }}</span>
      <span v-if="finding.anchorStatus === 'unanchored'" class="unb">未定位</span>
      <span v-if="finding.line" class="bidref">L{{ finding.line }}</span>
    </div>
    <h4>{{ finding.title }}</h4>
    <div class="quote">{{ finding.quote }}</div>
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
