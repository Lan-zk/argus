<script setup lang="ts">
// 首次运行引导层（spec: onboarding / design D2/D4/D5/D6）。
// 全屏覆盖、独立于三页导航；两步：pick（选服务商）→ configure（预设 Key+模型 / 自定义全字段）。
// 逻辑复用 model-discovery / settings.addModel（keyring、首条默认、同 Provider 复用），UI 与 SettingsPage 零共享。
// 主题兼容（design D6）：全部视觉属性经令牌引用，零硬编码色值；不透明 --paper 背景不透出主界面。
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { useSettingsStore } from "../stores/settings";
import { useOnboardingStore } from "../stores/onboarding";
import { GROUP_ZH, MODEL_PRESETS } from "../domain/presets";
import type { ModelPreset, PresetGroup } from "../domain/presets";
import type { DiscoveredModel } from "../domain/types";
import { catalogModels, customFetchInput, fetchRemoteModels, mergeModels, presetFetchInput } from "../ai/model-discovery";
import { isPlainHttpRemote } from "../lib/url";

const settings = useSettingsStore();
const onboarding = useOnboardingStore();

// ============ step 状态机（design D4，沿用 AddFlow 联合类型模式） ============
type Step = { kind: "pick" } | { kind: "preset"; preset: ModelPreset } | { kind: "custom"; local: boolean };
const step = ref<Step>({ kind: "pick" });

const presetGroups = computed(() => {
  const groups: PresetGroup[] = ["cn", "global", "aggregator"];
  return groups.map((g) => ({ key: g, label: GROUP_ZH[g], items: MODEL_PRESETS.filter((p) => p.group === g) }));
});

/** 当前预设（模板里窄化 step.preset 用；非 preset 步为 null）。 */
const curPreset = computed(() => (step.value.kind === "preset" ? step.value.preset : null));
/** 当前是否本地模型自定义（非 custom 步为 false）。 */
const curLocal = computed(() => step.value.kind === "custom" && step.value.local);

/** 重看场景（已有配置）hero 文案适配（design D7）。 */
const heroSubtitle = computed(() =>
  settings.models.length > 0 ? "再配一个模型，或跳过返回" : "两步完成：选择服务商，粘贴 API Key",
);

function pickPreset(preset: ModelPreset) {
  step.value = { kind: "preset", preset };
  void initPresetConfigure(preset);
}
function pickCustom(local: boolean) {
  step.value = { kind: "custom", local };
  void initCustomConfigure(local);
}
function backToPick() {
  step.value = { kind: "pick" };
}

// ---- 预设 configure（spec: onboarding 预设服务两步完成配置）----
const presetKey = ref("");
const presetKeyReused = ref(false); // 已复用已存 Key（跳过输入）
const presetModels = ref<DiscoveredModel[]>([]);
const presetModelId = ref("");
const fetching = ref(false);
const fetchError = ref("");

let fetchSeq = 0; // 竞态守卫：仅最后一次检索生效

async function initPresetConfigure(preset: ModelPreset) {
  presetKey.value = "";
  presetKeyReused.value = false;
  presetModelId.value = "";
  fetchError.value = "";
  // 静态目录先行（离线可用），推荐模型预选
  presetModels.value = await catalogModels(preset.id);
  presetModelId.value = preset.recommendedModel;
  // 同 Provider 复用 Key：存在则直接检索（spec: settings 同 Provider 复用 Key）
  const reused = await settings.reusableKey(preset.id);
  if (reused) {
    presetKeyReused.value = true;
    await doFetchModels();
  }
}

async function effectiveKey(): Promise<string> {
  if (presetKey.value.trim()) return presetKey.value.trim();
  return (await settings.reusableKey(curPreset.value?.id ?? "")) ?? "";
}

/** 触发模型检索（自动/手动共用）：静态目录 + 实时检索合并（design D5：检索即验证，不设连接门槛）。 */
async function doFetchModels() {
  const cur = curPreset.value;
  if (!cur) return;
  const seq = ++fetchSeq;
  fetching.value = true;
  fetchError.value = "";
  const key = await effectiveKey();
  const input = await presetFetchInput(cur.id, key);
  if (!input || !key) {
    fetching.value = false;
    return; // 无 Key：保留静态目录即可
  }
  const remote = await fetchRemoteModels(input);
  if (seq !== fetchSeq) return;
  fetching.value = false;
  if (remote.ok) {
    presetModels.value = mergeModels(
      presetModels.value.filter((m) => m.source === "catalog"),
      remote.models,
    );
    if (!presetModelId.value || !presetModels.value.some((m) => m.id === presetModelId.value)) {
      presetModelId.value = cur.recommendedModel;
    }
  } else {
    // 检索失败：弱提示，不阻断静态目录与保存（spec: onboarding 检索失败仍可保存）
    fetchError.value = remote.reason;
  }
}

/** Key 失焦且非空 → 300ms 防抖自动检索。 */
let blurTimer: ReturnType<typeof setTimeout> | null = null;
function onKeyBlur() {
  if (blurTimer) clearTimeout(blurTimer);
  if (!presetKey.value.trim()) return;
  presetKeyReused.value = false;
  blurTimer = setTimeout(() => void doFetchModels(), 300);
}
onBeforeUnmount(() => {
  if (blurTimer) clearTimeout(blurTimer);
});

/** 明文 http 端点告警（安全审计）：非本机 http:// 会未加密传输 API Key。 */
const HTTP_WARN = "⚠ 该地址为非本机的明文 HTTP 端点，API Key 将不经加密传输；建议改用 https，或确认仅用于本地/可信内网服务。";
const customHttpWarn = computed(() =>
  step.value.kind === "custom" && isPlainHttpRemote(customForm.value.baseUrl) ? HTTP_WARN : "",
);

const canSavePreset = computed(
  () => step.value.kind === "preset" && !!presetModelId.value && (!!presetKey.value.trim() || presetKeyReused.value),
);

async function savePreset() {
  const cur = curPreset.value;
  if (!cur || !presetModelId.value || !canSavePreset.value) return;
  const key = presetKey.value.trim() || (presetKeyReused.value ? await effectiveKey() : "");
  await settings.addModel({
    provider: cur.id,
    model: presetModelId.value,
    apiKey: key,
    contextWindow: presetModels.value.find((m) => m.id === presetModelId.value)?.contextWindow,
  });
  await onboarding.complete();
}

// ---- 自定义 / 本地 configure（spec: onboarding 本地模型无 Key 完成）----
const customForm = ref({ displayName: "", provider: "openai-compatible", baseUrl: "", apiKey: "", model: "" });
const customModels = ref<DiscoveredModel[]>([]);
const customFetching = ref(false);
const customFetchError = ref("");

async function initCustomConfigure(local: boolean) {
  customForm.value = {
    displayName: "",
    provider: "openai-compatible",
    baseUrl: local ? "http://localhost:11434/v1" : "",
    apiKey: "",
    model: "",
  };
  customModels.value = [];
  customFetchError.value = "";
}

async function fetchCustomModels() {
  const f = customForm.value;
  if (!f.baseUrl.trim()) return;
  customFetching.value = true;
  customFetchError.value = "";
  const remote = await fetchRemoteModels(customFetchInput({ provider: f.provider, baseUrl: f.baseUrl }, f.apiKey));
  customFetching.value = false;
  if (remote.ok) {
    customModels.value = remote.models;
    if (!f.model && remote.models.length) f.model = remote.models[0].id;
  } else {
    customFetchError.value = remote.reason;
  }
}

async function saveCustom() {
  const f = customForm.value;
  if (!f.model || step.value.kind !== "custom") return;
  await settings.addModel({
    provider: f.provider,
    model: f.model,
    apiKey: f.apiKey,
    baseUrl: f.baseUrl,
    displayName: f.displayName.trim() || undefined,
  });
  await onboarding.complete();
}

// ---- 每步 autofocus 首个输入件（design 细节；Esc 不绑定跳过，避免误触丢 Key 输入）----
const layerEl = ref<HTMLElement | null>(null);
watch(step, async () => {
  await nextTick();
  layerEl.value?.querySelector<HTMLElement>(".ob-step input, .ob-step select, .ob-step .ob-card")?.focus();
});
</script>

<template>
  <div v-if="onboarding.active" ref="layerEl" class="ob-layer" role="dialog" aria-modal="true" aria-label="首次运行引导">
    <header class="ob-head">
      <div class="ob-steps">
        <span class="ob-stepno" :class="{ on: step.kind === 'pick' }">01 选择服务</span>
        <span class="ob-arrow">—</span>
        <span class="ob-stepno" :class="{ on: step.kind !== 'pick' }">02 配置</span>
      </div>
      <button class="mini ob-skip" data-test="ob-skip" @click="onboarding.skip()">跳过，稍后在设置中配置</button>
    </header>

    <!-- 01 选择服务（自带轻量 hero，不设独立欢迎屏） -->
    <div v-if="step.kind === 'pick'" class="ob-body ob-step">
      <div class="ob-hero">
        <img src="/icon.png" alt="" class="ob-logo" draggable="false" />
        <h1>ARGUS <span class="microlabel">AI 文稿审阅</span></h1>
        <p class="ob-sub">{{ heroSubtitle }}</p>
        <p class="ob-trust">API Key 仅存入系统钥匙串 · 数据文件不含明文 · 随时可在设置中增删配置</p>
      </div>
      <section v-for="g in presetGroups" :key="g.key" class="ob-group">
        <div class="microlabel">{{ g.label }}</div>
        <div class="ob-grid">
          <button v-for="p in g.items" :key="p.id" class="ob-card" @click="pickPreset(p)">
            <b>{{ p.name }}</b>
            <span v-if="p.region" class="ob-region">{{ p.region }}</span>
            <span class="ob-model">{{ p.recommendedModel }}</span>
          </button>
        </div>
      </section>
      <section class="ob-group ob-alt">
        <div class="ob-grid">
          <button class="ob-card" @click="pickCustom(false)">
            <b>自定义连接</b>
            <span class="ob-model">任意 OpenAI-compatible 端点</span>
          </button>
          <button class="ob-card" @click="pickCustom(true)">
            <b>本地模型</b>
            <span class="ob-model">Ollama / LM Studio 等 · 无需 API Key</span>
          </button>
        </div>
      </section>
    </div>

    <!-- 02A 预设 configure：唯一必填 Key + 模型下拉 -->
    <div v-else-if="curPreset" class="ob-body ob-narrow ob-step">
      <div class="ob-chead">
        <button class="mini" @click="backToPick">← 重选服务</button>
        <b class="ob-cname">{{ curPreset.name }}</b>
        <span v-if="curPreset.region" class="session-chip">{{ curPreset.region }}</span>
        <span v-if="presetKeyReused" class="session-chip">✓ 已复用已保存的 Key</span>
      </div>
      <label class="ob-field">
        <span class="microlabel">API Key（唯一必填）</span>
        <input
          v-model="presetKey"
          type="password"
          placeholder="粘贴 API Key，离开输入框自动检索模型"
          autocomplete="off"
          data-test="ob-preset-key"
          @blur="onKeyBlur"
        />
      </label>
      <label class="ob-field">
        <span class="microlabel">
          模型
          <template v-if="fetching">· ◐ 检索中…</template>
          <template v-else-if="fetchError">· ⚠ {{ fetchError }}</template>
          <template v-else>· 共 {{ presetModels.length }} 个</template>
        </span>
        <select v-model="presetModelId" data-test="ob-preset-model">
          <option v-for="m in presetModels" :key="m.id" :value="m.id">
            {{ m.id }}{{ m.recommended ? "（推荐）" : "" }}{{ m.contextWindow ? ` · ${Math.round(m.contextWindow / 1000)}k ctx` : "" }}{{ m.source === "remote" ? " · 在线" : "" }}
          </option>
        </select>
      </label>
      <div class="ob-actions">
        <button class="mini" :disabled="fetching" @click="doFetchModels">↻ 重新检索</button>
        <span class="ob-note">检索失败不阻断：静态目录仍可选，可先保存后测试。</span>
        <span class="ob-flex"></span>
        <button class="primary" :disabled="!canSavePreset" data-test="ob-save" @click="savePreset">完成配置 →</button>
      </div>
    </div>

    <!-- 02B 自定义 / 本地 configure：全字段 -->
    <div v-else class="ob-body ob-narrow ob-step">
      <div class="ob-chead">
        <button class="mini" @click="backToPick">← 重选服务</button>
        <b class="ob-cname">{{ curLocal ? "本地模型" : "自定义连接" }}</b>
        <span class="session-chip">兼容任意 OpenAI-compatible 端点</span>
      </div>
      <div class="ob-fields">
        <label class="ob-field">
          <span class="microlabel">显示名称（可选）</span>
          <input v-model="customForm.displayName" type="text" placeholder="留空 = 自动命名" />
        </label>
        <label class="ob-field">
          <span class="microlabel">Base URL</span>
          <input v-model="customForm.baseUrl" type="text" data-test="ob-custom-baseurl" :placeholder="curLocal ? 'http://localhost:11434/v1' : 'https://…/v1'" />
          <span v-if="customHttpWarn" class="microlabel" style="color: var(--danger)">{{ customHttpWarn }}</span>
        </label>
        <label class="ob-field">
          <span class="microlabel">API Key（本地服务可留空）</span>
          <input v-model="customForm.apiKey" type="password" placeholder="sk-…" autocomplete="off" />
        </label>
        <label class="ob-field">
          <span class="microlabel">
            Model
            <template v-if="customFetching">· ◐ 检索中…</template>
            <template v-else-if="customFetchError">· ⚠ {{ customFetchError }}</template>
          </span>
          <input v-model="customForm.model" type="text" list="ob-custom-models" data-test="ob-custom-model" placeholder="手动输入，或检索后选择" />
        </label>
        <datalist id="ob-custom-models">
          <option v-for="m in customModels" :key="m.id" :value="m.id" />
        </datalist>
      </div>
      <div class="ob-actions">
        <button class="mini" :disabled="customFetching || !customForm.baseUrl" @click="fetchCustomModels">检索模型</button>
        <span class="ob-flex"></span>
        <button class="primary" :disabled="!customForm.model" data-test="ob-save" @click="saveCustom">完成配置 →</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ob-layer{position:fixed;inset:0;z-index:100;background:var(--paper);display:flex;flex-direction:column;overflow-y:auto}
.ob-head{display:flex;align-items:center;justify-content:space-between;padding:14px 28px;border-bottom:var(--hair);flex-shrink:0}
.ob-steps{display:flex;align-items:center}
.ob-stepno{font-size:10px;letter-spacing:.18em;text-transform:uppercase;font-weight:600;color:var(--ink35)}
.ob-stepno.on{color:var(--ink)}
.ob-arrow{color:var(--ink35);margin:0 10px}
.ob-body{max-width:920px;margin:0 auto;width:100%;padding:26px 28px 48px}
.ob-narrow{max-width:560px}
.ob-hero{text-align:center;margin:14px 0 22px}
.ob-hero h1{font-size:26px;display:flex;align-items:baseline;justify-content:center;gap:10px}
.ob-logo{width:40px;height:40px;display:block;margin:0 auto 12px;border-radius:var(--radius-sm)}
.ob-sub{font-size:14px;color:var(--ink70);margin-top:8px}
.ob-trust{font-size:11px;color:var(--ink50);margin-top:6px}
.ob-group{margin-top:16px}
.ob-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:10px;margin-top:8px}
.ob-card{display:flex;flex-direction:column;align-items:flex-start;gap:4px;padding:14px 16px;text-align:left;background:var(--card);border-radius:var(--radius-sm)}
.ob-card b{font-size:14px}
.ob-region{font-size:9.5px;color:var(--ink50);letter-spacing:.06em}
.ob-model{font-family:var(--mono);font-size:10px;color:var(--ink35);max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ob-alt{margin-top:20px;padding-top:16px;border-top:var(--hair)}
.ob-chead{display:flex;align-items:center;gap:10px;margin-bottom:18px;flex-wrap:wrap}
.ob-cname{font-size:16px}
.ob-field{display:flex;flex-direction:column;gap:6px}
.ob-fields{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.ob-actions{display:flex;align-items:center;gap:10px;margin-top:22px;flex-wrap:wrap}
.ob-note{font-size:10.5px;color:var(--ink50)}
.ob-flex{flex:1}
@media (max-width:640px){.ob-fields{grid-template-columns:1fr}}
</style>
