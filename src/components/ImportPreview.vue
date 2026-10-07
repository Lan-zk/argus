<script setup lang="ts">
// 导入预览确认层（spec: document-import 预览确认）：展示「将进入审阅的最终文本」，
// 提取损耗（表格糊化/断行错乱）可在此手动修正后确认；取消零落库。
// 超 30 000 字符走导入长文策略：警告长文降级影响并要求确认继续，MUST NOT 截断。
import { computed, ref } from "vue";
import { MAX_DOC_CHARS } from "../lib/constants";

const props = defineProps<{ kind: string; filename: string; text: string }>();
const emit = defineEmits<{ confirm: [text: string]; cancel: [] }>();

const draft = ref(props.text);
const overLimit = computed(() => draft.value.length > MAX_DOC_CHARS);
const KIND_ZH: Record<string, string> = { txt: "纯文本", md: "Markdown", docx: "Word 文档", pdf: "PDF" };
</script>

<template>
  <div class="imp-overlay" data-test="import-preview">
    <div class="imp-modal" role="dialog" aria-label="确认导入文本">
      <header class="imp-head">
        <h3>确认导入文本</h3>
        <p class="src" data-test="import-preview-src">
          {{ KIND_ZH[kind] ?? kind }} · {{ filename }} · {{ draft.length }} 字
        </p>
        <p class="note">
          审阅基于下方提取文本（原文件不会被保存）；表格、断行等提取损耗可先在此手动修正。
        </p>
      </header>
      <textarea
        v-model="draft"
        class="imp-text"
        spellcheck="false"
        data-test="import-preview-text"
      ></textarea>
      <div v-if="overLimit" class="imp-warn" data-test="import-overlimit-warn">
        文本超过 30 000 字符（当前 {{ draft.length }} 字）：将触发长文结构化降级、定位精度可能下降。确认后完整进入审阅流程，不会截断。
      </div>
      <footer class="imp-foot">
        <button class="mini" data-test="import-cancel" @click="emit('cancel')">取消</button>
        <button class="primary cta" data-test="import-confirm" @click="emit('confirm', draft)">
          {{ overLimit ? "继续导入（超长文本）" : "确认进入审阅" }}
        </button>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.imp-overlay {
  position: fixed;
  inset: 0;
  background: color-mix(in srgb, var(--ink) 45%, transparent);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: var(--z-pop);
  padding: 32px;
}
.imp-modal {
  display: flex;
  flex-direction: column;
  width: min(860px, 100%);
  max-height: 100%;
  background: var(--paper);
  border: var(--hair);
  box-shadow: 0 18px 50px rgb(from var(--ink) r g b / 25%);
  padding: 20px 22px;
  gap: 12px;
}
.imp-head h3 {
  font-size: 15px;
}
.imp-head .src {
  font-family: var(--mono);
  font-size: 11px;
  color: var(--ink70);
  margin-top: 4px;
}
.imp-head .note {
  font-size: 12px;
  color: var(--ink50);
  line-height: 1.7;
  margin-top: 2px;
}
.imp-text {
  flex: 1;
  min-height: 260px;
  resize: vertical;
  border: var(--hair);
  background: var(--paper2);
  color: var(--ink);
  font-size: 13px;
  line-height: 1.8;
  padding: 12px 14px;
  font-family: inherit;
}
.imp-text:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -1px;
}
.imp-warn {
  border: 2px solid var(--ochre);
  background: color-mix(in srgb, var(--ochre) 7%, transparent);
  color: var(--ochre);
  font-size: 12px;
  line-height: 1.7;
  padding: 8px 12px;
}
.imp-foot {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}
</style>
