<script setup lang="ts">
// Settings 页（spec: settings 全部场景 + model-config-ux）。
// Models 新增两步流程：pick（预设卡片/自定义连接）→ configure（预设只填 Key + 模型下拉；自定义全字段）。
// Key 失焦自动检索 + 手动刷新；同 Provider 复用钥匙串 Key；测试连接复用现有错误分类。
import { computed, onBeforeUnmount, ref } from "vue";
import { useSettingsStore } from "../stores/settings";
import { PROVIDERS, PROVIDER_ZH, isFourFamily } from "../domain/types";
import type { DiscoveredModel, ModelConfig } from "../domain/types";
import { GROUP_ZH, MODEL_PRESETS, displayProviderName, presetById } from "../domain/presets";
import type { ModelPreset, PresetGroup } from "../domain/presets";
import { DEFAULT_CATEGORIES } from "../domain/default-categories";
import { catalogModels, customFetchInput, fetchRemoteModels, mergeModels, presetFetchInput } from "../ai/model-discovery";
import { testConnection } from "../ai/test-connection";
import { keyring } from "../lib/keyring";
import { isPlainHttpRemote } from "../lib/url";
import { resolveTheme } from "../lib/theme";
import { useThemeStore } from "../stores/theme";
import { useOnboardingStore } from "../stores/onboarding";
import type { Appearance, ThemeStyle } from "../domain/types";
import CategoryColorPicker from "../components/CategoryColorPicker.vue";

const settings = useSettingsStore();
const onboarding = useOnboardingStore();

/** 颜色选择弹层当前打开的类别 id（spec: settings 类别颜色配置）。 */
const colorPickerFor = ref<string | null>(null);

// ============ Appearance 外观（spec: theme-system） ============
const themeStore = useThemeStore();
const themeOptions: { value: ThemeStyle; label: string }[] = [
  { value: "swiss", label: "瑞士风格" },
  { value: "apple", label: "Apple 风格" },
];
const appearanceOptions: { value: Appearance; label: string }[] = [
  { value: "light", label: "亮色" },
  { value: "dark", label: "暗色" },
  { value: "system", label: "跟随系统" },
];
const SKIN_ZH: Record<string, string> = {
  "swiss-light": "瑞士风格 · 亮色",
  "swiss-dark": "瑞士风格 · 暗色",
  "apple-light": "Apple 风格 · 亮色",
  "apple-dark": "Apple 风格 · 暗色",
};
const currentSkinLabel = computed(
  () => SKIN_ZH[resolveTheme(settings.ui.theme, settings.ui.appearance, themeStore.systemDark)],
);

/** 恢复内置类别：保留用户自定义，补回缺失的内置 7 类（spec: settings 内置默认类别）。 */
async function restoreBuiltinCategories() {
  const builtinIds = DEFAULT_CATEGORIES.map((c) => c.id);
  const customs = settings.categories.filter((c) => !builtinIds.includes(c.id));
  const missing = DEFAULT_CATEGORIES.filter((d) => !settings.categories.some((c) => c.id === d.id));
  settings.categories = [...customs, ...missing.map((m) => ({ ...structuredClone(m) }))];
  await settings.persist();
}

// ============ Models：新增两步流程（spec: settings 模型配置管理） ============
type AddFlow =
  | null // 未在新增
  | { kind: "pick" } // 第一步：选服务
  | { kind: "preset"; preset: ModelPreset } // 第二步：预设精简表单
  | { kind: "custom"; local?: boolean }; // 第二步：自定义连接全字段

const addFlow = ref<AddFlow>(null);
const presetGroups = computed(() => {
  const groups: PresetGroup[] = ["cn", "global", "aggregator"];
  return groups.map((g) => ({ key: g, label: GROUP_ZH[g], items: MODEL_PRESETS.filter((p) => p.group === g) }));
});

function startAdd() {
  addFlow.value = { kind: "pick" };
}
function pickPreset(preset: ModelPreset) {
  addFlow.value = { kind: "preset", preset };
  void initPresetConfigure(preset);
}
function pickCustom(local = false) {
  addFlow.value = { kind: "custom", local };
  void initCustomConfigure(local);
}

// ---- 预设 configure 状态 ----
const presetKey = ref("");
const presetKeyReused = ref(false); // 已复用已存 Key（跳过输入）
const showKeyInput = ref(true); // 「更换 Key」折叠
const presetModels = ref<DiscoveredModel[]>([]);
const presetModelId = ref("");
const fetching = ref(false);
const fetchError = ref("");
const presetAdvanced = ref(false);
const presetDisplayName = ref("");
const presetTemp = ref<number | undefined>(undefined);
const presetMaxTokens = ref<number | undefined>(undefined);

let fetchSeq = 0; // 竞态守卫：仅最后一次检索生效

async function initPresetConfigure(preset: ModelPreset) {
  presetKey.value = "";
  presetKeyReused.value = false;
  showKeyInput.value = true;
  presetModelId.value = "";
  fetchError.value = "";
  presetAdvanced.value = false;
  presetDisplayName.value = "";
  presetTemp.value = undefined;
  presetMaxTokens.value = undefined;
  // 静态目录先行（离线可用，spec: ai-runtime 预设服务离线展示模型目录）
  presetModels.value = await catalogModels(preset.id);
  presetModelId.value = preset.recommendedModel;
  // 同 Provider 复用 Key：存在则跳过输入直接检索（spec: settings 同 Provider 复用 Key）
  const reused = await settings.reusableKey(preset.id);
  if (reused) {
    presetKeyReused.value = true;
    showKeyInput.value = false;
    await doFetchModels();
  }
}

async function effectiveKey(): Promise<string> {
  if (presetKey.value.trim()) return presetKey.value.trim();
  return (await settings.reusableKey(addFlow.value?.kind === "preset" ? addFlow.value.preset.id : "")) ?? "";
}

/** 触发模型检索（自动/手动共用）：静态目录 + 实时检索合并。 */
async function doFetchModels() {
  if (addFlow.value?.kind !== "preset") return;
  const seq = ++fetchSeq;
  fetching.value = true;
  fetchError.value = "";
  const key = await effectiveKey();
  const input = await presetFetchInput(addFlow.value.preset.id, key);
  if (!input || !key) {
    fetching.value = false;
    return; // 无 Key：保留静态目录即可
  }
  const remote = await fetchRemoteModels(input);
  if (seq !== fetchSeq) return; // 已有更新的检索
  fetching.value = false;
  if (remote.ok) {
    presetModels.value = mergeModels(
      presetModels.value.filter((m) => m.source === "catalog"),
      remote.models,
    );
    if (!presetModelId.value || !presetModels.value.some((m) => m.id === presetModelId.value)) {
      presetModelId.value = addFlow.value.preset.recommendedModel;
    }
  } else {
    // 检索失败：弱提示，不阻断静态目录与手动输入（spec: ai-runtime 检索失败可降级）
    fetchError.value = remote.reason;
  }
}

/** Key 失焦且非空 → 300ms 防抖自动检索（spec: settings Key 失焦自动检索并可手动刷新）。 */
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

async function savePreset() {
  if (addFlow.value?.kind !== "preset" || !presetModelId.value) return;
  const key = presetKey.value.trim() || (presetKeyReused.value ? await effectiveKey() : "");
  const catalogModel = presetModels.value.find((m) => m.id === presetModelId.value);
  await settings.addModel({
    provider: addFlow.value.preset.id,
    model: presetModelId.value,
    apiKey: key,
    contextWindow: catalogModel?.contextWindow,
    temperature: presetTemp.value,
    maxTokens: presetMaxTokens.value,
    displayName: presetDisplayName.value || undefined,
  });
  addFlow.value = null;
}

// ---- 自定义连接 configure 状态 ----
const customForm = ref<Partial<ModelConfig> & { id?: string }>({});
const customModels = ref<DiscoveredModel[]>([]);
const customFetching = ref(false);
const customFetchError = ref("");
const customAdvanced = ref(false);

async function initCustomConfigure(local: boolean) {
  customForm.value = {
    provider: "openai-compatible",
    model: "",
    apiKey: "",
    baseUrl: local ? "http://localhost:11434/v1" : "",
  };
  customModels.value = [];
  customFetchError.value = "";
  customAdvanced.value = false;
}

function needsBaseUrl(p: string) {
  return p === "openai-compatible";
}

/** 明文 http 端点告警（安全审计）：非本机 http:// 会未加密传输 API Key。 */
const HTTP_WARN = "⚠ 该地址为非本机的明文 HTTP 端点，API Key 将不经加密传输；建议改用 https，或确认仅用于本地/可信内网服务。";
const httpWarn = (baseUrl: string | undefined) => (baseUrl && isPlainHttpRemote(baseUrl) ? HTTP_WARN : "");

const customNameFallback = computed(() => {
  const f = customForm.value;
  return `自定义 · ${f.model || "模型ID"}`;
});

async function fetchCustomModels() {
  const f = customForm.value;
  if (!f.baseUrl?.trim()) return;
  customFetching.value = true;
  customFetchError.value = "";
  const remote = await fetchRemoteModels(customFetchInput({ provider: f.provider ?? "openai-compatible", baseUrl: f.baseUrl }, f.apiKey ?? ""));
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
  if (!f.model || !f.provider) return;
  if (needsBaseUrl(f.provider) && !f.baseUrl) return;
  await settings.addModel({
    provider: f.provider,
    model: f.model,
    apiKey: f.apiKey ?? "",
    baseUrl: f.baseUrl,
    temperature: f.temperature,
    maxTokens: f.maxTokens,
    contextWindow: f.contextWindow,
    displayName: f.displayName?.trim() || undefined,
  });
  addFlow.value = null;
}

// ---- 编辑已有配置（按来源分流：预设形态 / 自定义全字段；Key 脱敏回显） ----
const editingModel = ref<Partial<ModelConfig> & { id?: string } | null>(null);
const editModels = ref<DiscoveredModel[]>([]);

/** 该配置是否来自预设（决定编辑表单形态）。 */
const editingIsPreset = computed(() => !!editingModel.value && !!presetById(String(editingModel.value.provider)));

/** 模型下拉数据 = 目录 ∪ 当前值（目录外模型兜底为选项）。 */
const editModelOptions = computed<DiscoveredModel[]>(() => {
  const cur = editingModel.value?.model;
  if (cur && !editModels.value.some((m) => m.id === cur)) {
    return [{ id: cur, source: "catalog" }, ...editModels.value];
  }
  return editModels.value;
});

async function editModel(id: string) {
  const m = settings.models.find((x) => x.id === id);
  if (!m) return;
  // 脱敏：不回显完整 Key（spec: app-persistence 界面不回显完整 Key）
  editingModel.value = { ...m, apiKey: "" };
  addFlow.value = null;
  if (presetById(String(m.provider))) {
    editModels.value = await catalogModels(String(m.provider));
  }
}

async function saveModel() {
  const m = editingModel.value;
  if (!m || !m.model || !m.provider) return;
  if (needsBaseUrl(m.provider) && !m.baseUrl) return;
  const patch: Partial<ModelConfig> = {
    provider: m.provider,
    model: m.model,
    baseUrl: m.baseUrl,
    displayName: m.displayName?.trim() || undefined,
    temperature: m.temperature,
    maxTokens: m.maxTokens,
    contextWindow: m.contextWindow,
  };
  if (m.apiKey) patch.apiKey = m.apiKey;
  await settings.updateModel(m.id!, patch);
  editingModel.value = null;
}

// ---- 测试连接 ----
const testResult = ref<Record<string, { ok: boolean; text: string }>>({});
const testing = ref<Record<string, boolean>>({});

async function runTest(cfg: ModelConfig) {
  testing.value = { ...testing.value, [cfg.id]: true };
  const key = await settings.getApiKey(cfg);
  const res = await testConnection(cfg, key);
  testResult.value = {
    ...testResult.value,
    [cfg.id]: res.ok
      ? { ok: true, text: `连接成功 · 模型 ${res.model}${res.usage ?? ""}` }
      : { ok: false, text: res.error.message },
  };
  testing.value = { ...testing.value, [cfg.id]: false };
}

function providerLabel(m: ModelConfig): string {
  return isFourFamily(m.provider) ? PROVIDER_ZH[m.provider] : displayProviderName(m.provider);
}

// ---- Categories ----
const openCat = ref<string | null>(null);
function toggleCatEditor(id: string) {
  openCat.value = openCat.value === id ? null : id;
}

// ---- 钥匙串诊断 ----
const keyringStatus = ref("");
void keyring.probe("diagnostic").then((r) => {
  keyringStatus.value = r.roundtrip
    ? `✓ 钥匙串读写正常（service=${r.service}）`
    : "✗ 钥匙串读写往返失败，请检查系统安全设置";
});

const CONTEXT_VARS = ["document", "blocks", "category", "output_schema"];
void presetById;
</script>

<template>
  <section class="page on">
    <div class="set-wrap">
      <!-- 3.1 Models -->
      <div class="set-sec">
        <div class="sec-head">
          <span class="n">3.1</span><h2>Models 模型配置</h2>
          <span class="hint">系统不内置 API Key · Key 存系统钥匙串，数据文件不含明文</span>
        </div>

        <!-- 已有配置列表 -->
        <div v-for="m in settings.models" :key="m.id" class="model-row" :class="{ 'def-model': m.isDefault }">
          <div class="mr-top">
            <span class="microlabel">{{ providerLabel(m) }}</span>
            <b>{{ m.displayName || m.model }}</b>
            <span v-if="m.displayName" class="session-chip">{{ m.model }}</span>
            <span v-if="m.baseUrl" class="session-chip">{{ m.baseUrl }}</span>
            <span
              v-if="m.baseUrl && isPlainHttpRemote(m.baseUrl)"
              class="microlabel"
              style="color: var(--danger)"
              title="非本机明文 HTTP 端点：API Key 将不经加密传输"
            >⚠ 明文 HTTP</span>
            <span v-if="m.isDefault" class="microlabel" style="color: var(--accent)">默认</span>
            <span class="spacer" style="flex: 1"></span>
            <button v-if="!m.isDefault" class="mini" @click="settings.setDefaultModel(m.id)">设为默认</button>
            <button class="mini" @click="editModel(m.id)">编辑</button>
            <button class="mini danger" @click="settings.deleteModel(m.id)">删除</button>
            <button class="mini" :disabled="testing[m.id]" @click="runTest(m)">
              {{ testing[m.id] ? "测试中…" : "测试连接" }}
            </button>
          </div>
          <div v-if="testResult[m.id]" class="test-line" :class="testResult[m.id].ok ? 'ok' : 'bad'">
            {{ testResult[m.id].text }}
          </div>
        </div>

        <!-- 第一步：选服务（pick） -->
        <div v-if="addFlow?.kind === 'pick'" class="model-row" style="border: 2px solid var(--ink)">
          <div class="pick-head">
            <span class="microlabel">选择服务</span>
            <span class="microlabel" style="margin-left: auto; color: var(--ink35)">预设自动填充端点与协议，只需填 API Key</span>
          </div>
          <div v-for="g in presetGroups" :key="g.key" class="preset-group">
            <div class="microlabel" style="margin-bottom: 8px">{{ g.label }}</div>
            <div class="preset-grid">
              <button v-for="p in g.items" :key="p.id" class="preset-card" @click="pickPreset(p)">
                <b>{{ p.name }}</b>
                <span v-if="p.region" class="preset-region">{{ p.region }}</span>
                <span class="preset-models">{{ p.recommendedModel }}</span>
              </button>
            </div>
          </div>
          <div class="preset-group" style="margin-top: 14px; padding-top: 14px; border-top: var(--hair)">
            <div class="preset-grid">
              <button class="preset-card" @click="pickCustom(false)">
                <b>自定义连接</b>
                <span class="preset-models">任意 OpenAI-compatible 端点</span>
              </button>
              <button class="preset-card" @click="pickCustom(true)">
                <b>本地模型</b>
                <span class="preset-models">Ollama / LM Studio 等</span>
              </button>
            </div>
          </div>
          <div class="mr-top" style="border-top: var(--hair)">
            <button class="mini" @click="addFlow = null">取消</button>
          </div>
        </div>

        <!-- 第二步 A：预设 configure（唯一必填 API Key + 模型下拉） -->
        <div v-else-if="addFlow?.kind === 'preset'" class="model-row" style="border: 2px solid var(--ink)">
          <div class="mr-top" style="border-bottom: var(--hair)">
            <b style="font-size: 14px">{{ addFlow.preset.name }}</b>
            <span v-if="addFlow.preset.region" class="session-chip">{{ addFlow.preset.region }}</span>
            <span class="session-chip">{{ presetModels.length ? `端点已内置 · 目录 ${presetModels.filter(m => m.source === 'catalog').length} 个模型` : "端点已内置" }}</span>
            <span v-if="presetKeyReused" class="microlabel" style="color: var(--ink50)">✓ 已复用已保存的 Key</span>
          </div>
          <div class="mr-grid" style="grid-template-columns: repeat(2, 1fr)">
            <div class="fg" style="grid-column: span 2" v-if="showKeyInput">
              <span class="microlabel">API Key（唯一必填）</span>
              <input
                v-model="presetKey"
                type="password"
                placeholder="粘贴 API Key，离开输入框自动检索模型"
                autocomplete="off"
                @blur="onKeyBlur"
              />
            </div>
            <div class="fg" style="grid-column: span 2" v-else>
              <button class="mini" @click="showKeyInput = true">更换 Key</button>
            </div>
            <div class="fg" style="grid-column: span 2">
              <span class="microlabel">
                模型
                <template v-if="fetching">· ◐ 检索中…</template>
                <template v-else-if="fetchError">· ⚠ {{ fetchError }}</template>
                <template v-else>· 共 {{ presetModels.length }} 个</template>
              </span>
              <select v-model="presetModelId">
                <option v-for="m in presetModels" :key="m.id" :value="m.id">
                  {{ m.id }}{{ m.recommended ? "（推荐）" : "" }}{{ m.contextWindow ? ` · ${Math.round(m.contextWindow / 1000)}k ctx` : "" }}{{ m.source === "remote" ? " · 在线" : "" }}
                </option>
              </select>
            </div>
          </div>
          <div class="mr-top" style="border-top: var(--hair); flex-wrap: wrap; gap: 8px">
            <button class="mini" :disabled="fetching" @click="doFetchModels">↻ 重新检索</button>
            <button class="mini" @click="presetAdvanced = !presetAdvanced">{{ presetAdvanced ? "收起高级" : "高级" }}</button>
            <span style="flex: 1"></span>
            <button class="mini" @click="addFlow = null">取消</button>
            <button
              class="mini primary"
              :disabled="!presetModelId || (!presetKey.trim() && !presetKeyReused)"
              @click="savePreset"
            >保存</button>
          </div>
          <div v-if="presetAdvanced" class="mr-grid" style="grid-template-columns: repeat(4, 1fr)">
            <div class="fg">
              <span class="microlabel">显示名称</span>
              <input v-model="presetDisplayName" type="text" :placeholder="`${addFlow.preset.name} · ${presetModelId || addFlow.preset.recommendedModel}`" />
            </div>
            <div class="fg">
              <span class="microlabel">Temperature</span>
              <input v-model.number="presetTemp" type="number" step="0.1" min="0" max="2" placeholder="默认" />
            </div>
            <div class="fg">
              <span class="microlabel">Max Tokens</span>
              <input v-model.number="presetMaxTokens" type="number" min="256" placeholder="默认" />
            </div>
            <div class="fg">
              <span class="microlabel">Context Window</span>
              <input
                :value="presetModels.find(m => m.id === presetModelId)?.contextWindow ?? ''"
                type="number"
                disabled
                placeholder="目录元数据"
              />
            </div>
          </div>
        </div>

        <!-- 第二步 B：自定义连接 configure（全字段 + 检索/手动并存） -->
        <div v-else-if="addFlow?.kind === 'custom'" class="model-row" style="border: 2px solid var(--ink)">
          <div class="mr-top" style="border-bottom: var(--hair)">
            <b style="font-size: 14px">{{ addFlow.local ? "本地模型" : "自定义连接" }}</b>
            <span class="session-chip">兼容任意 OpenAI-compatible 端点</span>
          </div>
          <div class="mr-grid">
            <div class="fg" style="grid-column: span 2">
              <span class="microlabel">显示名称（可选，用于快速区分）</span>
              <input v-model="customForm.displayName" type="text" :placeholder="customNameFallback" />
            </div>
            <div class="fg">
              <span class="microlabel">Provider 家族</span>
              <select v-model="customForm.provider">
                <option v-for="p in PROVIDERS" :key="p" :value="p">{{ PROVIDER_ZH[p] }}</option>
              </select>
            </div>
            <div class="fg g2">
              <span class="microlabel">Base URL</span>
              <input v-model="customForm.baseUrl" type="text" placeholder="https://…/api/paas/v4" />
              <span v-if="httpWarn(customForm.baseUrl)" class="microlabel" style="color: var(--danger)">{{ httpWarn(customForm.baseUrl) }}</span>
            </div>
            <div class="fg g2">
              <span class="microlabel">API Key</span>
              <input v-model="customForm.apiKey" type="password" placeholder="sk-…（本地服务可留空）" autocomplete="off" />
            </div>
            <div class="fg g2">
              <span class="microlabel">
                Model
                <template v-if="customFetching">· ◐ 检索中…</template>
                <template v-else-if="customFetchError">· ⚠ {{ customFetchError }}</template>
              </span>
              <input v-model="customForm.model" type="text" list="custom-model-list" placeholder="手动输入，或检索后选择" />
              <datalist id="custom-model-list">
                <option v-for="m in customModels" :key="m.id" :value="m.id" />
              </datalist>
            </div>
            <div class="fg">
              <span class="microlabel">Temperature</span>
              <input v-model.number="customForm.temperature" type="number" step="0.1" min="0" max="2" placeholder="默认" />
            </div>
            <div class="fg">
              <span class="microlabel">Max Tokens</span>
              <input v-model.number="customForm.maxTokens" type="number" min="256" placeholder="默认" />
            </div>
          </div>
          <div class="mr-top" style="border-top: var(--hair)">
            <button class="mini" :disabled="customFetching || !customForm.baseUrl" @click="fetchCustomModels">检索模型</button>
            <span style="flex: 1"></span>
            <button class="mini" @click="addFlow = null">取消</button>
            <button class="mini primary" :disabled="!customForm.model" @click="saveCustom">保存</button>
          </div>
        </div>

        <!-- 编辑：预设形态（沿用配置时的精简交互） -->
        <div v-if="editingModel && editingIsPreset" class="model-row" style="border: 2px solid var(--ink)">
          <div class="mr-top" style="border-bottom: var(--hair)">
            <b style="font-size: 14px">{{ displayProviderName(String(editingModel.provider)) }}</b>
            <span class="session-chip">端点已内置</span>
            <span class="session-chip">编辑 · 目录 {{ editModels.length }} 个模型</span>
          </div>
          <div class="mr-grid" style="grid-template-columns: repeat(2, 1fr)">
            <div class="fg" style="grid-column: span 2">
              <span class="microlabel">显示名称（可选）</span>
              <input v-model="editingModel.displayName" type="text" placeholder="留空 = 服务名 · 模型 ID" />
            </div>
            <div class="fg" style="grid-column: span 2">
              <span class="microlabel">模型</span>
              <select v-model="editingModel.model">
                <option v-for="m in editModelOptions" :key="m.id" :value="m.id">
                  {{ m.id }}{{ m.contextWindow ? ` · ${Math.round(m.contextWindow / 1000)}k ctx` : "" }}{{ editModels.some((x) => x.id === m.id) ? "" : "（目录外）" }}
                </option>
              </select>
            </div>
            <div class="fg" style="grid-column: span 2">
              <span class="microlabel">API Key（留空 = 保持已存 Key）</span>
              <input v-model="editingModel.apiKey" type="password" placeholder="sk-…" autocomplete="off" />
            </div>
            <div class="fg">
              <span class="microlabel">Temperature</span>
              <input v-model.number="editingModel.temperature" type="number" step="0.1" min="0" max="2" placeholder="默认" />
            </div>
            <div class="fg">
              <span class="microlabel">Max Tokens</span>
              <input v-model.number="editingModel.maxTokens" type="number" min="256" placeholder="默认" />
            </div>
          </div>
          <div class="mr-top" style="border-top: var(--hair)">
            <button class="mini primary" :disabled="!editingModel.model" @click="saveModel">保存</button>
            <button class="mini" @click="editingModel = null">取消</button>
          </div>
        </div>

        <!-- 编辑：自定义连接形态（全字段） -->
        <div v-else-if="editingModel" class="model-row" style="border: 2px solid var(--ink)">
          <div class="mr-grid">
            <div class="fg" style="grid-column: span 2">
              <span class="microlabel">显示名称（可选）</span>
              <input v-model="editingModel.displayName" type="text" placeholder="留空 = 服务名 · 模型 ID" />
            </div>
            <div class="fg">
              <span class="microlabel">Provider</span>
              <input :value="providerLabel(editingModel as ModelConfig)" type="text" disabled />
            </div>
            <div class="fg g2">
              <span class="microlabel">Model Name</span>
              <input v-model="editingModel.model" type="text" />
            </div>
            <div class="fg g2">
              <span class="microlabel">API Key（留空=不修改）</span>
              <input v-model="editingModel.apiKey" type="password" placeholder="sk-…" autocomplete="off" />
            </div>
            <div class="fg g2" v-if="needsBaseUrl(String(editingModel.provider))">
              <span class="microlabel">Base URL</span>
              <input v-model="editingModel.baseUrl" type="text" />
              <span v-if="httpWarn(editingModel.baseUrl)" class="microlabel" style="color: var(--danger)">{{ httpWarn(editingModel.baseUrl) }}</span>
            </div>
            <div class="fg">
              <span class="microlabel">Temperature</span>
              <input v-model.number="editingModel.temperature" type="number" step="0.1" min="0" max="2" placeholder="默认" />
            </div>
            <div class="fg">
              <span class="microlabel">Max Tokens</span>
              <input v-model.number="editingModel.maxTokens" type="number" min="256" placeholder="默认" />
            </div>
            <div class="fg">
              <span class="microlabel">Context Window</span>
              <input v-model.number="editingModel.contextWindow" type="number" min="4096" placeholder="按 Provider 默认" />
            </div>
          </div>
          <div class="mr-top" style="border-top: var(--hair)">
            <button class="mini primary" :disabled="!editingModel.model" @click="saveModel">保存</button>
            <button class="mini" @click="editingModel = null">取消</button>
          </div>
        </div>

        <button v-if="!addFlow" @click="startAdd">＋ 新增模型配置</button>
        <div class="info-note">
          {{ keyringStatus || "钥匙串诊断中…" }} ·
          Key 通过系统安全存储保存；日志与错误信息不含完整 Key。预设服务只需填 API Key，模型列表自动检索；同一服务的第二个模型自动复用已存 Key。
        </div>
        <button class="mini" style="margin-top: 10px" data-test="rerun-onboarding" @click="onboarding.start()">
          ↻ 重新运行引导
        </button>
      </div>

      <!-- 3.2 Categories -->
      <div class="set-sec">
        <div class="sec-head">
          <span class="n">3.2</span><h2>Review Categories 审阅类别</h2>
          <span class="hint">每类独立 Prompt · 修改互不影响</span>
        </div>

        <div v-for="(c, i) in [...settings.categories].sort((a, b) => a.order - b.order)" :key="c.id" class="cat-set-row">
          <div class="csr-top">
            <button
              type="button"
              class="csq csq-btn"
              :aria-label="`更改 ${c.name} 颜色`"
              :style="{ background: c.color ?? 'var(--gray)' }"
              @click="colorPickerFor = colorPickerFor === c.id ? null : c.id"
            ></button>
            <b>{{ c.name }}</b>
            <span class="en">{{ c.en }}</span>
            <label class="ctl"><input v-model="c.enabled" type="checkbox" @change="settings.updateCategory(c.id, { enabled: c.enabled })" />启用</label>
            <label class="ctl"><input v-model="c.defaultSelected" type="checkbox" @change="settings.updateCategory(c.id, { defaultSelected: c.defaultSelected })" />默认选中</label>
            <span class="spacer"></span>
            <button class="mini" :disabled="i === 0" @click="settings.moveCategory(c.id, -1)">↑</button>
            <button class="mini" :disabled="i === settings.categories.length - 1" @click="settings.moveCategory(c.id, 1)">↓</button>
            <button class="mini" @click="settings.duplicateCategory(c.id)">复制</button>
            <button class="mini danger" @click="settings.deleteCategory(c.id)">删除</button>
            <button class="mini primary" @click="toggleCatEditor(c.id)">
              {{ openCat === c.id ? "收起" : "编辑 Prompt" }}
            </button>
          </div>
          <CategoryColorPicker
            v-if="colorPickerFor === c.id"
            :model-value="c.color ?? 'var(--gray)'"
            @select="(color) => settings.updateCategory(c.id, { color })"
            @close="colorPickerFor = null"
          />
          <div v-if="openCat === c.id" class="csr-body">
            <div class="mr-grid" style="padding: 0 0 12px">
              <div class="fg g2">
                <span class="microlabel">名称</span>
                <input :value="c.name" type="text" @change="settings.updateCategory(c.id, { name: ($event.target as HTMLInputElement).value })" />
              </div>
              <div class="fg g4" style="grid-column: span 4">
                <span class="microlabel">说明</span>
                <input :value="c.description" type="text" @change="settings.updateCategory(c.id, { description: ($event.target as HTMLInputElement).value })" />
              </div>
            </div>
            <span class="microlabel">Prompt（独立生效，修改后重跑该类别即可应用）</span>
            <textarea
              :value="c.prompt"
              style="width: 100%"
              spellcheck="false"
              @change="settings.updateCategory(c.id, { prompt: ($event.target as HTMLTextAreaElement).value })"
            ></textarea>
            <div class="ctx-chips">
              <span v-for="v in CONTEXT_VARS" :key="v">{{ v }}</span>
            </div>
            <div class="ctx-note">
              可用上下文：document（带行号全文或降级结构表示）· blocks（文档块）· category（当前类别）·
              output_schema（输出格式约束，含 quote/lineHint/contentHash 与归一化 hash 规则）。系统按四段结构自动组装，无需在类别
              Prompt 中重复输出格式要求。
            </div>
          </div>
        </div>

        <button @click="settings.addCategory({ name: '新类别' })">＋ 新建 Category</button>
        <div class="info-note">
          内置 6 个默认启用类别（逻辑 / 论点 / 论证 / 修辞 / 结构 / 清晰度）与 1 个默认禁用类别（演讲表达）；删除内置类别后可用「恢复内置」找回。
        </div>
        <button class="mini" style="margin-top: 10px" @click="restoreBuiltinCategories">恢复内置类别</button>
      </div>

      <!-- 3.3 Appearance 外观（spec: theme-system） -->
      <div class="set-sec">
        <div class="sec-head">
          <span class="n">3.3</span><h2>Appearance 外观</h2>
          <span class="hint">主题与明暗独立选择 · 立即生效</span>
        </div>
        <div class="frow">
          <span class="microlabel">主题</span>
          <span
            v-for="t in themeOptions"
            :key="t.value"
            class="fchip"
            :class="{ on: settings.ui.theme === t.value }"
            :data-theme-option="t.value"
            @click="settings.setTheme(t.value)"
            >{{ t.label }}</span
          >
        </div>
        <div class="frow" style="margin-top: 10px">
          <span class="microlabel">明暗</span>
          <span
            v-for="a in appearanceOptions"
            :key="a.value"
            class="fchip"
            :class="{ on: settings.ui.appearance === a.value }"
            :data-appearance-option="a.value"
            @click="settings.setAppearance(a.value)"
            >{{ a.label }}</span
          >
        </div>
        <div class="ctx-note">「跟随系统」随操作系统明暗自动切换 · 当前生效：{{ currentSkinLabel }}</div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.pick-head{display:flex;align-items:center;padding:12px 16px}
.preset-group{padding:10px 16px 4px}
.preset-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px}
.preset-card{display:flex;flex-direction:column;align-items:flex-start;gap:3px;padding:10px 12px;text-align:left;background:var(--card);
  transition:background-color .15s var(--ease-out-quint),color .15s var(--ease-out-quint)}
.preset-card:hover{background:var(--ink);color:var(--paper)}
.preset-card:hover .preset-models,.preset-card:hover .preset-region{color:var(--paper2)}
.preset-card b{font-size:13px}
.preset-region{font-size:9.5px;color:var(--ink50);letter-spacing:.06em}
.preset-models{font-family:var(--mono);font-size:9.5px;color:var(--ink35);max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
</style>
