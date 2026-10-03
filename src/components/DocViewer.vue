<script setup lang="ts">
// DocViewer（spec: review-ui 只读原文渲染 + 高亮与双向定位）。
// 基于块模型渲染 Markdown（标题/引用/列表/代码），行号显示，只读。
// 高亮按区间切片渲染；重叠区间叠加多层下划线（原型 .hl.u1/.u2/.u3 方案）；
// unanchored Finding 不产生高亮。
import { computed } from "vue";
import type { DocumentBlock, Finding } from "../domain/types";
import { inlineMd } from "../domain/parser";
import { openExternal } from "../lib/opener";

const props = withDefaults(
  defineProps<{
    blocks: DocumentBlock[];
    findings: Finding[];
    /** categoryId → 颜色（内置类别用 design token，自定义类别来自设置）。 */
    colorMap?: Record<string, string>;
    showLines?: boolean;
    selectedFindingId?: string | null;
    hoverFindingId?: string | null;
  }>(),
  { showLines: true, selectedFindingId: null, hoverFindingId: null },
);

const emit = defineEmits<{
  (e: "highlight-click", ids: string[], anchorEl: HTMLElement): void;
  (e: "highlight-hover", ids: string[] | null): void;
}>();

interface Segment {
  start: number;
  end: number;
  ids: string[];
}

interface RenderBlock {
  block: DocumentBlock;
  tag: string;
  cls: string;
  segments: (Segment & { html: string; colors: string[] })[];
}

const anchored = computed(() => props.findings.filter((f) => f.anchorStatus === "anchored" && f.blockId));

function colorOf(categoryId: string): string {
  return props.colorMap?.[categoryId] ?? "var(--gray)";
}

const rendered = computed<RenderBlock[]>(() =>
  props.blocks.map((b) => {
    const mine = anchored.value
      .filter((f) => f.blockId === b.id && f.startOffset !== undefined && f.endOffset !== undefined)
      .map((f) => ({ id: f.id, s: f.startOffset!, e: f.endOffset!, categoryId: f.categoryId }));
    // 切点：0、len、每个区间端点
    const pts = new Set<number>([0, b.plainText.length]);
    for (const f of mine) {
      pts.add(Math.max(0, Math.min(b.plainText.length, f.s)));
      pts.add(Math.max(0, Math.min(b.plainText.length, f.e)));
    }
    const arr = [...pts].sort((x, y) => x - y);
    const segments: RenderBlock["segments"] = [];
    for (let i = 0; i < arr.length - 1; i++) {
      const a = arr[i];
      const c = arr[i + 1];
      if (c <= a) continue;
      const hits = mine.filter((f) => f.s <= a && f.e >= c);
      const ids = hits.map((f) => f.id);
      const colors = [...new Set(hits.map((f) => colorOf(f.categoryId)))];
      segments.push({ start: a, end: c, ids, html: inlineMd(b.plainText.slice(a, c)), colors });
    }
    const h = b.type.startsWith("heading") ? Number(b.type.slice(7)) : 0;
    const tag =
      h === 1 ? "h1" : h === 2 ? "h2" : h >= 3 ? "h3" : b.type === "quote" ? "blockquote" : b.type === "code" ? "pre" : "p";
    const headingCls = h >= 3 ? "heading3" : b.type;
    return { block: b, tag, cls: `blk b-${headingCls}`, segments };
  }),
);

function hlStyle(seg: RenderBlock["segments"][number]): Record<string, string> {
  const u1 = seg.colors[0] ?? "var(--ink)";
  const u2 = seg.colors[1] ?? u1;
  const u3 = seg.colors[2] ?? u2;
  return { "--u1": u1, "--u2": u2, "--u3": u3 };
}

function onHlClick(e: MouseEvent, ids: string[]) {
  // 阻止冒泡：多 Finding 弹层由 Workspace 定位展示，避免被窗口级点击关闭逻辑立即收起
  e.stopPropagation();
  emit("highlight-click", ids, e.currentTarget as HTMLElement);
}

/** 文档内链接统一交系统打开：capture 阶段拦截（先于高亮 span 的 stopPropagation），阻断 WebView 内导航。 */
function onDocClickCapture(e: MouseEvent) {
  const a = (e.target as HTMLElement | null)?.closest?.("a");
  if (!a) return;
  const href = a.getAttribute("href");
  if (!href) return;
  e.preventDefault();
  e.stopPropagation();
  void openExternal(href);
}
function onHlEnter(ids: string[]) {
  emit("highlight-hover", ids);
}
function onHlLeave() {
  emit("highlight-hover", null);
}
function segClass(seg: RenderBlock["segments"][number]): Record<string, boolean> {
  return {
    hl: seg.ids.length > 0,
    [`u${Math.min(3, seg.ids.length)}`]: seg.ids.length > 0,
    sel: !!props.selectedFindingId && seg.ids.includes(props.selectedFindingId),
  };
}
</script>

<template>
  <div class="docbody" :class="{ 'show-lines': showLines !== false }" @click.capture="onDocClickCapture">
    <component
      :is="rb.tag"
      v-for="rb in rendered"
      :key="rb.block.id"
      :class="rb.cls"
      :data-block-id="rb.block.id"
    >
      <span v-if="showLines !== false" class="bid">L{{ rb.block.line }}</span
      ><template v-for="(seg, i) in rb.segments" :key="i"
        ><span
          v-if="seg.ids.length"
          :class="segClass(seg)"
          :style="hlStyle(seg)"
          @click="onHlClick($event, seg.ids)"
          @mouseenter="onHlEnter(seg.ids)"
          @mouseleave="onHlLeave"
          v-html="seg.html"
        ></span
        ><span v-else v-html="seg.html"></span></template
    ></component>
  </div>
</template>
