<script setup lang="ts">
// New Review 页（spec: review-ui 输入/选择/校验场景 + document-import 文件导入）。
// 大输入区 + 字符计数（粘贴路径 30 000 上限）+ 文件导入（txt/md/docx/pdf，预览确认后写入）
// + 类别复选框（默认选中来自设置）+ 全选/清空/恢复默认 + 三项前置校验。
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useSettingsStore } from "../stores/settings";
import { useSessionStore } from "../stores/session";
import { useUiStore } from "../stores/ui";
import { useOnboardingStore } from "../stores/onboarding";
import { useProjectsStore } from "../stores/projects";
import { MAX_DOC_CHARS } from "../lib/constants";
import type { ImportResult } from "../lib/importers";
import type { ImportSource } from "../domain/types";
import ImportPreview from "../components/ImportPreview.vue";

const settings = useSettingsStore();
const session = useSessionStore();
const ui = useUiStore();
const onboarding = useOnboardingStore();
const projects = useProjectsStore();

/** 新一轮上下文：活动项目已有轮次 → 显示「第 N 轮 · 沿用上轮配置」。 */
const nextRoundNumber = computed(() => ((projects.activeRounds[projects.activeRounds.length - 1]?.number ?? 0)) + 1);
const isSubsequentRound = computed(() => projects.activeRounds.length > 0);

const text = computed({
  get: () => settings.draftText,
  set: (v: string) => {
    // 30 000 截断仅作用于粘贴/手动输入路径（spec: review-ui 原文输入与长度上限 delta）。
    // 导入写入走 settings.setDraftText 直写绕过；已超限的导入长文在输入区的手动修正同样
    // 不截断——否则任何一次按键都会砍掉导入稿，与「导入超长不受阻止」矛盾。
    const imported = settings.draftText.length > MAX_DOC_CHARS;
    const clipped = !imported && v.length > MAX_DOC_CHARS ? v.slice(0, MAX_DOC_CHARS) : v;
    void settings.setDraftText(clipped);
  },
});

// ---- 文件导入（spec: document-import 预览确认 / 导入长文策略）----
const importPreview = ref<ImportResult | null>(null);
const importError = ref("");
const importing = ref(false);
/** 待随本轮落库的导入来源；粘贴（或整段替换为非导入内容）后失效。 */
const pendingImportSource = ref<ImportSource | null>(null);
/** 导入文本开头指纹：区分「导入稿上的修正」（保留来源）与「粘贴整段替换」（来源失效）。 */
const importedHead = ref("");

async function startImport() {
  importError.value = "";
  importing.value = true;
  try {
    // 动态加载导入器整棵子树（mammoth/pdfjs/插件 wrapper 均不进首屏，spec: 体积约束）
    const { importDocument } = await import("../lib/importers");
    const result = await importDocument();
    if (result) importPreview.value = result; // null = 用户在选择框取消，无状态变化
  } catch (e) {
    importError.value = e instanceof Error ? e.message : String(e);
  } finally {
    importing.value = false;
  }
}

function confirmImport(finalText: string) {
  const result = importPreview.value;
  importPreview.value = null;
  if (!result) return;
  // 导入写入绕过 30k 截断（超限警告已在预览层确认，spec: 导入长文策略）
  void settings.setDraftText(finalText);
  pendingImportSource.value = { kind: result.kind, filename: result.filename, importedAt: result.importedAt };
  importedHead.value = finalText.slice(0, 16);
}

function cancelImport() {
  importPreview.value = null; // 取消：丢弃解析产物，零落库（spec: 预览确认）
}

// 草稿清空或开头被整体替换 → 导入来源失效（避免把粘贴稿错标为导入）
watch(
  () => settings.draftText,
  (v) => {
    if (!pendingImportSource.value) return;
    if (v === "" || !v.startsWith(importedHead.value)) {
      pendingImportSource.value = null;
      importedHead.value = "";
    }
  },
);

const checked = ref<Set<string>>(new Set());
const startErrors = ref<string[]>([]);
const starting = ref(false);

// 已启用类别（禁用类别不出现）；进入页面时勾选 = 各类别默认选中
const cats = computed(() => settings.enabledCategories);

// ---- 组切换器（spec: review-ui 类别选择；design D3 纯 UI 状态，不持久化）----
/** 当前视图："all" | 组 id（通用为 null）。进入页面恒为「全部」+ defaultSelected 预选（现状不变）。 */
const activeGroup = ref<"all" | string | null>("all");

/** 无自定义组时切换器不显示（行为等同「全部」视图）。 */
const hasCustomGroups = computed(() => settings.groups.length > 0);

/** 切换器项：全部 + 各分组（通用置顶、自定义组按设置中的顺序）；置灰 = 该组无任何 enabled 类别（design D4 派生）。 */
const switcherItems = computed(() => [
  { key: "all", label: "全部", id: "all" as const, disabled: false },
  ...settings.allGroups.map((g) => ({
    key: `g:${g.id ?? "general"}`,
    label: g.name,
    id: g.id as string | null,
    disabled: !cats.value.some((c) => (c.groupId ?? null) === g.id),
  })),
]);

/** 可见分节：全部视图 = 各组分节（空节隐藏，禁用类别不出现）；组视图 = 仅该组。 */
const visibleSections = computed(() => {
  if (activeGroup.value === "all") {
    return settings.allGroups
      .map((group) => ({ group, cats: cats.value.filter((c) => (c.groupId ?? null) === group.id) }))
      .filter((sec) => sec.cats.length > 0);
  }
  const group = settings.allGroups.find((g) => g.id === activeGroup.value);
  return group ? [{ group, cats: cats.value.filter((c) => (c.groupId ?? null) === group.id) }] : [];
});

const visibleCats = computed(() => visibleSections.value.flatMap((sec) => sec.cats));

/** 点分组 = 勾选集整体替换为该组 enabled 全集（快捷入口而非互斥边界）；
 * 点「全部」仅切回全量视图，不动勾选。 */
function selectGroup(id: "all" | string | null) {
  const item = switcherItems.value.find((i) => i.id === id);
  if (item?.disabled) return; // 空组置灰不可选
  activeGroup.value = id;
  if (id !== "all") {
    checked.value = new Set(cats.value.filter((c) => (c.groupId ?? null) === id).map((c) => c.id));
  }
}

// 组被删（如设置页操作）→ 当前组视图不存在，回落「全部」
watch(
  () => settings.groups,
  (gs) => {
    if (activeGroup.value !== "all" && !gs.some((g) => g.id === activeGroup.value)) {
      activeGroup.value = "all";
    }
  },
);

// 设置加载完成后初始化勾选：活动项目已有轮次 → 沿用上一轮类别集合（spec: 新一轮配置沿用）；
// 否则按各类别「默认选中」
watch(
  () => settings.loaded,
  (loaded) => {
    if (loaded && checked.value.size === 0) {
      const prev = projects.activeRounds[projects.activeRounds.length - 1];
      checked.value = new Set(prev ? prev.categorySnapshot.map((e) => e.categoryId) : settings.defaultSelectedIds);
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
  // 作用域为当前可见类别：组视图下「全选」= 勾全该组（跨组已勾项保留）；「全部」视图与旧行为一致
  const next = new Set(checked.value);
  for (const c of visibleCats.value) next.add(c.id);
  checked.value = next;
}
function selectNone() {
  checked.value = new Set();
}
function selectDefault() {
  // 恢复默认仅重置勾选为「默认选中」集合，MUST NOT 改变当前视图（spec: review-ui 类别选择）
  checked.value = new Set(settings.defaultSelectedIds);
}

const overLimit = computed(() => text.value.length >= MAX_DOC_CHARS);
/** 导入长文：超 30k 但来自导入路径——不阻止，提示降级影响（spec: 导入长文策略）。 */
const importedOver = computed(() => text.value.length > MAX_DOC_CHARS);

// Cmd/Ctrl+Enter：开始审阅（快捷键体系；本页随 v-if 挂载/卸载，监听自动生效）
function onKeydown(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
    e.preventDefault();
    void startReview();
  }
}
onMounted(() => window.addEventListener("keydown", onKeydown));
onBeforeUnmount(() => window.removeEventListener("keydown", onKeydown));

/** 前置校验（spec: 开始审阅前置校验）：逐项列出，不只显示「发生错误」。 */
function validate(): string[] {
  const errs: string[] = [];
  if (!text.value.trim()) errs.push("原文为空，请先粘贴需要审阅的文稿。");
  if (checked.value.size === 0) errs.push("没有选择任何审阅类别，请至少勾选一个。");
  if (!settings.defaultModel) errs.push("没有可用模型配置，请到设置中添加。");
  return errs;
}

async function startReview() {
  startErrors.value = validate();
  if (startErrors.value.length) return;
  if (session.isRunning) {
    startErrors.value = ["已有审阅正在进行，请前往「审阅工作台」查看进度。"];
    return;
  }
  starting.value = true;
  // 立即跳转：工作台逐类状态条即刻呈现进度（spec: review-ui 加载反馈），
  // 审阅在后台执行，不阻塞导航
  ui.goReview("workspace");
  // 有上一轮时自动落在「对比」页签：L1 即时检查（改没改）不等 AI 即可见（spec: 即时「改没改」检查）
  if (projects.activeRounds.length > 1) ui.setSideTab("compare");
  try {
    await session.startReview(text.value, [...checked.value], {
      sourceMeta: pendingImportSource.value ?? { kind: "paste" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (session.runList.length === 0) {
      // 启动即失败（尚未创建任何 run）：回输入页展示错误；run 已创建的情形由 store 加固在工作台标失败
      ui.goReview("new");
      startErrors.value = [msg];
    }
  } finally {
    starting.value = false;
  }
}
</script>

<template>
  <section class="page page-new on">
    <div class="new-wrap">
      <div class="new-left">
        <!-- 跳过引导后的接续提示（spec: onboarding 无模型状态的接续提示） -->
        <div v-if="settings.loaded && !settings.defaultModel" class="ob-continue" data-test="no-model-hint">
          <span>尚未配置模型：开始审阅前需要至少一条可用的模型配置。</span>
          <button class="mini" @click="onboarding.start()">重新运行引导</button>
          <button class="mini" @click="ui.go('settings')">前往设置</button>
        </div>
        <!-- 新一轮上下文（spec: review-versioning 新一轮配置沿用）：沿用上轮时明示 -->
        <div v-if="isSubsequentRound" class="round-ctx">
          <b>{{ projects.activeProject?.name }}</b>
          <span class="ctx-note">第 {{ nextRoundNumber }} 轮 · 类别与模型默认沿用上一轮，保证跨轮对比纯净</span>
        </div>
        <div class="sec-head">
          <span class="n">A</span><h2>原文输入</h2>
          <span class="hint">支持 Markdown · 粘贴或导入文件</span>
          <button
            class="mini import-entry"
            data-test="import-entry"
            :disabled="importing"
            title="支持 txt / md / docx / pdf；Word 请另存为 .docx，扫描件 PDF 不支持"
            @click="startImport"
          >
            {{ importing ? "导入中…" : "导入文件" }}
          </button>
        </div>
        <!-- 导入排除/失败指引（spec: 支持格式与排除项——明确指引，不做静默降级） -->
        <div v-if="importError" class="errbox" data-test="import-error">
          <h5>无法导入该文件</h5>
          <ul>
            <li>{{ importError }}</li>
          </ul>
        </div>
        <textarea
          v-model="text"
          class="doc-input"
          spellcheck="false"
          placeholder="粘贴需要审阅的文章 / 演讲稿 / 逐字稿 / Markdown 文稿，或从上方导入 txt / md / docx / pdf 文件……"
        ></textarea>
        <div class="charcount" :class="{ over: overLimit }">
          <span>{{ text.length }} / 30 000</span>
        </div>
        <div v-if="importedOver" class="charcount over" data-test="imported-over-note">
          <span>导入长文：已超 30 000 字符，将触发长文结构化降级、定位精度可能下降；完整文本将进入审阅（不截断）</span>
        </div>
        <div v-else-if="overLimit" class="charcount over"><span>已达上限：超限内容不会进入审阅</span></div>
        <div class="new-actions">
          <button
            class="primary cta"
            :disabled="starting || session.isRunning"
            @click="startReview"
          >
            {{ session.isRunning ? "审阅进行中…" : starting ? "正在启动…" : "开始审阅" }}
            <span v-if="!session.isRunning && !starting" class="cta-cnt">· <span class="mono">{{ checked.size }}</span> 类</span>
            <span v-if="!session.isRunning && !starting" class="cta-arr" aria-hidden="true">→</span>
          </button>
          <div v-if="session.isRunning" class="info-note" style="margin-top: 12px">
            已有审阅正在进行，逐类进度与结果实时显示在「审阅工作台」。
          </div>

          <div v-if="startErrors.length" class="errbox">
            <h5>无法开始审阅 · 请检查以下项</h5>
            <ul>
              <li v-for="e in startErrors" :key="e">{{ e }}</li>
            </ul>
          </div>
        </div>
        <div class="info-note">
          本产品是审阅工具，不是编辑器：原文在此输入后于工作台中只读；系统只发现问题、解释问题、提出建议，不修改原文。导入的 Word / PDF 文稿基于提取文本审阅，原文件不会被保存。
        </div>
      </div>
      <div class="new-right">
        <div class="sec-head">
          <span class="n">B</span><h2>审阅类别</h2>
          <span class="hint">已选 <span class="mono">{{ checked.size }} / {{ cats.length }}</span></span>
        </div>
        <!-- 组切换器（spec: review-ui 类别选择）：无自定义组时不显示；空组置灰 -->
        <div v-if="hasCustomGroups" class="group-switcher" data-test="group-switcher">
          <button
            v-for="item in switcherItems"
            :key="item.key"
            class="fchip"
            :class="{ on: activeGroup === item.id }"
            :disabled="item.disabled"
            :data-test="`group-tab-${item.key}`"
            :aria-pressed="activeGroup === item.id"
            @click="selectGroup(item.id)"
          >{{ item.label }}</button>
        </div>
        <div class="catlist">
          <template v-for="sec in visibleSections" :key="sec.group.id ?? 'general'">
            <div v-if="activeGroup === 'all'" class="cat-group-label" :data-test="`cat-section-${sec.group.id ?? 'general'}`">{{ sec.group.name }}</div>
            <label v-for="c in sec.cats" :key="c.id" class="catrow">
              <input type="checkbox" :checked="isChecked(c.id)" @change="toggleCat(c.id)" />
              <span class="csq" :style="{ background: c.color ?? 'var(--gray)' }"></span>
              <span>
                <b>{{ c.name }}</b><span class="en">{{ c.en }}</span>
                <div class="desc">{{ c.description }}</div>
              </span>
            </label>
          </template>
        </div>
        <div style="display: flex; gap: 10px; margin-top: 12px">
          <button class="mini" @click="selectAll">全选</button>
          <button class="mini" @click="selectNone">清空</button>
          <button class="mini" @click="selectDefault">恢复默认</button>
        </div>
        <div class="info-note">
          每个 Category 使用完全独立的 Prompt，可并行执行；单项失败不影响其他类别。在
          <b>设置 → Review Categories</b> 中可自定义；分组是快捷入口，切换后仍可跨组自由增减勾选。
        </div>
      </div>
    </div>

    <!-- 导入预览确认层（spec: document-import 预览确认） -->
    <ImportPreview
      v-if="importPreview"
      :kind="importPreview.kind"
      :filename="importPreview.filename"
      :text="importPreview.text"
      @confirm="confirmImport"
      @cancel="cancelImport"
    />
  </section>
</template>

<style scoped>
/* layout P2-10：左栏内容限宽 ~900px——粘贴面在宽窗口不再无限拉伸（页面度量与 set-wrap/ob-body 同逻辑） */
.new-left :is(.round-ctx,.sec-head,.doc-input,.charcount,.info-note,.errbox,.new-actions,.ob-continue){max-width:900px}
.import-entry{align-self:center;flex-shrink:0}
.ob-continue{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:14px;padding:10px 14px;background:var(--card);border:var(--hair);color:var(--ink70);font-size:12px}

.round-ctx {
  display: flex;
  align-items: baseline;
  gap: 12px;
  border: var(--hair);
  background: var(--card);
  padding: 10px 14px;
  margin-bottom: 16px;
}
.round-ctx b {
  font-size: 14px;
}
.ctx-note {
  font-size: 11px;
  color: var(--ink50);
}

/* 组切换器（spec: review-ui 类别选择）：fchip 药丸 + 空组置灰 */
.group-switcher{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px}
.group-switcher .fchip:disabled{opacity:.4;cursor:not-allowed}
.group-switcher .fchip:disabled:hover{border-color:var(--ink35)}
/* 「全部」视图按组分节的小标题 */
.cat-group-label{font-size:11px;font-weight:700;letter-spacing:.08em;color:var(--ink50);margin:10px 0 6px}
.cat-group-label:first-child{margin-top:0}
</style>
