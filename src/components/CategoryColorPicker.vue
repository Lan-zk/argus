<script setup lang="ts">
// 类别颜色选择弹层（spec: settings Review Category 颜色配置 / design D3-D4）。
// 策展色板存 var(--pN) 随主题走；自定义 hex 对当前皮肤底色做 ≥3:1 校验，仅提示不阻断。
import { onBeforeUnmount, onMounted, ref } from "vue";
import { CATEGORY_PALETTE } from "../domain/palette";
import { contrastRatio } from "../lib/contrast";

const props = defineProps<{ modelValue: string }>();
const emit = defineEmits<{ select: [color: string]; close: [] }>();

const customHex = ref(props.modelValue.startsWith("#") ? props.modelValue : "#888888");
const warn = ref(false);
const rootEl = ref<HTMLElement>();

/** 读取当前皮肤令牌计算值；无样式环境（单测未注入）返回 null，跳过校验不误报。 */
function resolveBg(token: string): string | null {
  const v = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
  return v || null;
}

function isLowContrast(hex: string): boolean {
  const bgs = [resolveBg("--paper"), resolveBg("--card")].filter(Boolean) as string[];
  if (bgs.length === 0) return false;
  return bgs.some((bg) => {
    const r = contrastRatio(hex, bg);
    return r === null || r < 3;
  });
}

function pick(color: string) {
  warn.value = false;
  emit("select", color);
  emit("close");
}

function onCustom(e: Event) {
  const hex = (e.target as HTMLInputElement).value;
  customHex.value = hex;
  warn.value = isLowContrast(hex);
  emit("select", hex); // 即时应用；保持打开以便继续微调并查看提示
}

function onKey(e: KeyboardEvent) {
  if (e.key === "Escape") emit("close");
}
/** 点击外部关闭；入口色块自身除外（由其 click 负责开合切换）。 */
function onOutside(e: PointerEvent) {
  const t = e.target as Element;
  if (rootEl.value?.contains(t as Node) || t?.closest?.(".csq-btn")) return;
  emit("close");
}

onMounted(() => {
  window.addEventListener("keydown", onKey);
  document.addEventListener("pointerdown", onOutside);
});
onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKey);
  document.removeEventListener("pointerdown", onOutside);
});
</script>

<template>
  <div ref="rootEl" class="ccp" role="dialog" aria-label="类别颜色" @pointerdown.stop>
    <div class="ccp-grid">
      <button
        v-for="p in CATEGORY_PALETTE"
        :key="p.var"
        type="button"
        class="ccp-sw"
        :class="{ on: modelValue === p.var }"
        :style="{ background: p.var }"
        :aria-label="p.label"
        :title="p.label"
        @click="pick(p.var)"
      ></button>
    </div>
    <div class="ccp-custom">
      <label class="ctl"
        ><input type="color" :value="customHex" @input="onCustom" />自定义</label
      >
      <span v-if="warn" class="ccp-warn" role="status">⚠ 当前皮肤下对比度偏低</span>
    </div>
  </div>
</template>

<style scoped>
.ccp{position:absolute;top:calc(100% + 6px);left:0;z-index:40;min-width:224px;padding:12px;
  background:var(--card);border:2px solid var(--ink);border-radius:var(--radius);
  box-shadow:var(--shadow-pop);animation:popin .16s var(--ease-out-quint);transform-origin:top left}
.ccp-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:8px}
.ccp-sw{width:26px;height:26px;padding:0;border:2px solid var(--ink15);border-radius:var(--radius-round);cursor:pointer;
  transition:transform .12s var(--ease-out-quint),border-color .12s var(--ease-out-quint)}
.ccp-sw:hover{transform:scale(1.12);border-color:var(--ink)}
.ccp-sw.on{border-color:var(--ink);outline:2px solid var(--accent);outline-offset:1px}
.ccp-custom{display:flex;align-items:center;gap:8px;margin-top:10px;padding-top:10px;border-top:var(--hair);
  font-size:11px;color:var(--ink50)}
.ccp-custom input[type=color]{width:26px;height:26px;padding:0;border:1px solid var(--ink35);border-radius:6px;
  background:var(--card);cursor:pointer}
.ccp-warn{color:var(--danger);font-size:10.5px;font-weight:600}

/* Apple 主题走毛玻璃（与 .pop 同语法；置于同文件末尾以在特异性平局时取胜） */
:global([data-theme^="apple"] .ccp){
  background:color-mix(in srgb,var(--paper) 82%,transparent);
  backdrop-filter:saturate(180%) blur(20px);-webkit-backdrop-filter:saturate(180%) blur(20px);
  border:1px solid var(--ink15);box-shadow:none}
</style>
