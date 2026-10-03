<script setup lang="ts">
// ReportView（spec: review-report 内容四部分 + 回跳）。
// 四部分：总体摘要 / 优先问题 / Category Summary（含失败类标注）/ 完整 Findings 入口。
import { computed } from "vue";
import type { Finding, ReviewReport, ReviewCategory } from "../domain/types";
import { SEVERITY_ZH } from "../domain/types";

const props = defineProps<{
  report: ReviewReport;
  findings: Finding[];
  categories: ReviewCategory[];
  colorMap: Record<string, string>;
}>();

const emit = defineEmits<{
  (e: "jump", findingId: string): void;
  (e: "open-findings"): void;
}>();

const priorityFindings = computed(() =>
  props.report.priorityFindingIds
    .map((id) => props.findings.find((f) => f.id === id))
    .filter((f): f is Finding => !!f),
);

const catName = (id: string) => props.categories.find((c) => c.id === id)?.name ?? id;
const failedNames = computed(() => props.report.failedCategoryIds.map(catName));
</script>

<template>
  <div class="report">
    <div v-if="failedNames.length" class="rp-failbanner">
      ⚠ {{ failedNames.length }} 个类别执行失败（{{ failedNames.join("、") }}），未计入下方统计；可单独重跑后重新生成报告。
    </div>
    <div v-if="report.degraded" class="rp-failbanner" style="border-color: var(--ochre); color: var(--ochre)">
      本报告为程序化生成（报告模型调用失败或未配置），仅含统计与严重度排序。
    </div>

    <div class="rp-sec">
      <h3><span class="n">R.1</span>总体摘要</h3>
      <p class="sum">{{ report.summary }}</p>
    </div>

    <div class="rp-sec">
      <h3><span class="n">R.2</span>优先问题<span class="n">{{ priorityFindings.length }}</span></h3>
      <div v-for="(f, i) in priorityFindings" :key="f.id" class="prio-item" @click="emit('jump', f.id)">
        <span class="pn">{{ String(i + 1).padStart(2, "0") }}</span>
        <span class="csq" :style="{ background: colorMap[f.categoryId], width: '8px', height: '8px', display: 'inline-block' }"></span>
        <b>{{ f.title }}</b>
        <span class="meta">{{ catName(f.categoryId) }} · {{ SEVERITY_ZH[f.severity] }}</span>
      </div>
      <p v-if="!priorityFindings.length" class="sum" style="color: var(--ink50)">本次 Review 未发现该类别下的明显问题。</p>
    </div>

    <div class="rp-sec">
      <h3><span class="n">R.3</span>Category Summary</h3>
      <table class="catsum">
        <thead>
          <tr><th>类别</th><th>严重</th><th>建议修改</th><th>可优化</th><th>小结</th></tr>
        </thead>
        <tbody>
          <tr v-for="s in report.categorySummaries" :key="s.categoryId">
            <td>
              <span class="csq" :style="{ background: colorMap[s.categoryId] }"></span>{{ catName(s.categoryId) }}
            </td>
            <td>{{ s.high }}</td>
            <td>{{ s.medium }}</td>
            <td>{{ s.low }}</td>
            <td style="font-family: var(--sans); font-size: 12px">{{ s.summary }}</td>
          </tr>
          <tr v-for="fid in report.failedCategoryIds" :key="fid" class="failed-row">
            <td><span class="csq" style="background: var(--danger)"></span>{{ catName(fid) }}（失败）</td>
            <td>—</td>
            <td>—</td>
            <td>—</td>
            <td style="font-family: var(--sans); font-size: 12px">执行失败，未产生结果</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="rp-sec">
      <h3><span class="n">R.4</span>完整 Findings<span class="n">{{ findings.length }}</span></h3>
      <button class="mini" @click="emit('open-findings')">在批注面板查看全部 →</button>
    </div>
  </div>
</template>
