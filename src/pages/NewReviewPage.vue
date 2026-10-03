<script setup lang="ts">
// New Review 页（spec: review-ui 输入/选择/校验场景）。
// 大输入区 + 字符计数（30 000 上限）+ 类别复选框（默认选中来自设置）+ 全选/清空/恢复默认 + 三项前置校验。
import { computed, ref, watch } from "vue";
import { useSettingsStore } from "../stores/settings";
import { useSessionStore } from "../stores/session";
import { useUiStore } from "../stores/ui";
import { MAX_DOC_CHARS } from "../lib/constants";

const settings = useSettingsStore();
const session = useSessionStore();
const ui = useUiStore();

const text = computed({
  get: () => settings.draftText,
  set: (v: string) => {
    // 粘贴超长文本：阻止超出部分进入输入区（spec: 原文输入与长度上限）
    const clipped = v.length > MAX_DOC_CHARS ? v.slice(0, MAX_DOC_CHARS) : v;
    void settings.setDraftText(clipped);
  },
});

const checked = ref<Set<string>>(new Set());
const startErrors = ref<string[]>([]);
const starting = ref(false);

// 已启用类别（禁用类别不出现）；进入页面时勾选 = 各类别默认选中
const cats = computed(() => settings.enabledCategories);

// 设置加载完成后，按各类别「默认选中」初始化勾选（spec: 类别选择）
watch(
  () => settings.loaded,
  (loaded) => {
    if (loaded && checked.value.size === 0) {
      checked.value = new Set(settings.defaultSelectedIds);
    }
  },
  { immediate: true },
);

function isChecked(id: string): boolean {
  return checked.value.has(id);
}

function toggleCat(id: string) {
  const next = new Set(checked.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  checked.value = next;
}

function selectAll() {
  checked.value = new Set(cats.value.map((c) => c.id));
}
function selectNone() {
  checked.value = new Set();
}
function selectDefault() {
  checked.value = new Set(settings.defaultSelectedIds);
}

const overLimit = computed(() => text.value.length >= MAX_DOC_CHARS);

/** 前置校验（spec: 开始审阅前置校验）：逐项列出，不只显示「发生错误」。 */
function validate(): string[] {
  const errs: string[] = [];
  if (!text.value.trim()) errs.push("原文为空，请先粘贴需要审阅的文稿。");
  if (checked.value.size === 0) errs.push("没有选择任何 Review Category，请至少勾选一个类别。");
  if (!settings.defaultModel) errs.push("没有可用模型配置，请到设置中添加。");
  return errs;
}

async function startReview() {
  startErrors.value = validate();
  if (startErrors.value.length) return;
  starting.value = true;
  try {
    await session.startReview(text.value, [...checked.value]);
    ui.go("workspace");
  } catch (err) {
    startErrors.value = [err instanceof Error ? err.message : String(err)];
  } finally {
    starting.value = false;
  }
}
</script>

<template>
  <section class="page on">
    <div class="new-wrap">
      <div class="new-left">
        <div class="sec-head">
          <span class="n">1.1</span><h2>原文输入</h2>
          <span class="hint">支持 Markdown · 粘贴后结构将被保留</span>
        </div>
        <textarea
          v-model="text"
          class="doc-input"
          spellcheck="false"
          placeholder="粘贴需要审阅的文章 / 演讲稿 / 逐字稿 / Markdown 文稿……"
        ></textarea>
        <div class="charcount" :class="{ over: overLimit }">
          <span>{{ text.length }} 字符</span>
          <span>{{ text.length }} / 30 000</span>
        </div>
        <div v-if="overLimit" class="charcount over"><span>已达上限：超限内容不会进入审阅</span></div>
        <div class="new-actions">
          <button
            class="primary"
            style="font-size: 14px; padding: 12px 34px"
            :disabled="starting"
            @click="startReview"
          >
            {{ starting ? "正在启动…" : "开始审阅 →" }}
          </button>
          <div v-if="startErrors.length" class="errbox">
            <h5>无法开始审阅 · 请检查以下项</h5>
            <ul>
              <li v-for="e in startErrors" :key="e">{{ e }}</li>
            </ul>
          </div>
          <div class="info-note">
            本产品是审阅工具，不是编辑器：原文在此输入后于工作台中只读；系统只发现问题、解释问题、提出建议，不修改原文（PRD
            §2）。
          </div>
        </div>
      </div>
      <div class="new-right">
        <div class="sec-head">
          <span class="n">1.2</span><h2>Review Category</h2>
          <span class="hint">已选 {{ checked.size }} / {{ cats.length }}</span>
        </div>
        <div class="catlist">
          <label v-for="c in cats" :key="c.id" class="catrow">
            <input type="checkbox" :checked="isChecked(c.id)" @change="toggleCat(c.id)" />
            <span class="csq" :style="{ background: c.color ?? 'var(--gray)' }"></span>
            <span>
              <b>{{ c.name }}</b><span class="en">{{ c.en }}</span>
              <div class="desc">{{ c.description }}</div>
            </span>
          </label>
        </div>
        <div style="display: flex; gap: 10px; margin-top: 12px">
          <button class="mini" @click="selectAll">全选</button>
          <button class="mini" @click="selectNone">清空</button>
          <button class="mini" @click="selectDefault">恢复默认</button>
        </div>
        <div class="info-note" style="margin-top: 22px">
          每个 Category 使用完全独立的 Prompt，可并行执行；单项失败不影响其他类别。在
          <b>设置 → Review Categories</b> 中可自定义。
        </div>
      </div>
    </div>
  </section>
</template>
