<script setup lang="ts">
// Settings 页（spec: settings 全部场景）。
// Models：CRUD + 默认 + 测试连接（可读错误）；Categories：CRUD/启停/默认选中/排序/复制/Prompt 编辑器
//（上下文变量提示）；内置 7 默认类别种子；钥匙串诊断。
import { ref } from "vue";
import { useSettingsStore } from "../stores/settings";
import { PROVIDERS, PROVIDER_ZH } from "../domain/types";
import type { ModelConfig, ProviderKind } from "../domain/types";
import { DEFAULT_CATEGORIES } from "../domain/default-categories";
import { testConnection } from "../ai/test-connection";
import { keyring } from "../lib/keyring";

const settings = useSettingsStore();

/** 恢复内置类别：保留用户自定义，补回缺失的内置 7 类（spec: settings 内置默认类别）。 */
async function restoreBuiltinCategories() {
  const builtinIds = DEFAULT_CATEGORIES.map((c) => c.id);
  const customs = settings.categories.filter((c) => !builtinIds.includes(c.id));
  const missing = DEFAULT_CATEGORIES.filter((d) => !settings.categories.some((c) => c.id === d.id));
  settings.categories = [...customs, ...missing.map((m) => ({ ...structuredClone(m) }))];
  await settings.persist();
}

// ---- Models ----
const editingModel = ref<Partial<ModelConfig> & { id?: string } | null>(null);
const testResult = ref<Record<string, { ok: boolean; text: string }>>({});
const testing = ref<Record<string, boolean>>({});

function providerOf(p: string): ProviderKind {
  return (PROVIDERS as string[]).includes(p) ? (p as ProviderKind) : "openai-compatible";
}

function needsBaseUrl(p: ProviderKind) {
  return p === "openai-compatible";
}

async function saveModel() {
  const m = editingModel.value;
  if (!m || !m.model || !m.provider) return;
  if (needsBaseUrl(m.provider as ProviderKind) && !m.baseUrl) return;
  if (m.id) {
    const patch: Partial<ModelConfig> = {
      provider: m.provider as ProviderKind,
      model: m.model,
      baseUrl: m.baseUrl,
      temperature: m.temperature,
      maxTokens: m.maxTokens,
      contextWindow: m.contextWindow,
    };
    // Key 仅在用户输入了新值时更新（编辑界面脱敏回显，不回显完整 Key）
    if (m.apiKey) patch.apiKey = m.apiKey;
    await settings.updateModel(m.id, patch);
  } else {
    await settings.addModel({
      provider: m.provider as ProviderKind,
      model: m.model,
      apiKey: m.apiKey ?? "",
      baseUrl: m.baseUrl,
      temperature: m.temperature,
      maxTokens: m.maxTokens,
      contextWindow: m.contextWindow,
    });
  }
  editingModel.value = null;
}

function editModel(id: string) {
  const m = settings.models.find((x) => x.id === id);
  if (!m) return;
  // 脱敏：不回显完整 Key（spec: app-persistence 界面不回显完整 Key）
  editingModel.value = { ...m, apiKey: m.keyringRef ? "" : "" };
}

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
</script>

<template>
  <section class="page on">
    <div class="set-wrap">
      <!-- 3.1 Models -->
      <div class="set-sec">
        <div class="sec-head">
          <span class="n">3.1</span><h2>Models 模型配置</h2>
          <span class="hint">系统不内置 API Key · Key 存系统钥匙串，数据文件不含明文（PRD §21–23）</span>
        </div>

        <div v-for="m in settings.models" :key="m.id" class="model-row" :class="{ 'def-model': m.isDefault }">
          <div class="mr-top">
            <span class="microlabel">{{ PROVIDER_ZH[m.provider] }}</span>
            <b>{{ m.model }}</b>
            <span v-if="m.baseUrl" class="session-chip">{{ m.baseUrl }}</span>
            <span v-if="m.isDefault" class="microlabel" style="color: var(--red)">默认</span>
            <span class="spacer" style="flex: 1"></span>
            <button v-if="!m.isDefault" class="mini" @click="settings.setDefaultModel(m.id)">设为默认</button>
            <button class="mini" @click="editModel(m.id)">编辑</button>
            <button class="mini danger" @click="settings.deleteModel(m.id)">删除</button>
            <button class="mini" :disabled="testing[m.id]" @click="runTest(m)">
              {{ testing[m.id] ? "测试中…" : "测试连接" }}
            </button>
          </div>
          <div
            v-if="testResult[m.id]"
            class="test-line"
            :class="testResult[m.id].ok ? 'ok' : 'bad'"
          >{{ testResult[m.id].text }}</div>
        </div>

        <div v-if="editingModel" class="model-row" style="border: 2px solid var(--ink)">
          <div class="mr-grid">
            <div class="fg">
              <span class="microlabel">Provider</span>
              <select v-model="editingModel.provider">
                <option v-for="p in PROVIDERS" :key="p" :value="p">{{ PROVIDER_ZH[p] }}</option>
              </select>
            </div>
            <div class="fg g2">
              <span class="microlabel">Model Name</span>
              <input v-model="editingModel.model" type="text" placeholder="如 gpt-4o / claude-sonnet-4-5 / glm-4.7" />
            </div>
            <div class="fg g2">
              <span class="microlabel">API Key {{ editingModel.id ? "（留空=不修改）" : "" }}</span>
              <input v-model="editingModel.apiKey" type="password" placeholder="sk-…" autocomplete="off" />
            </div>
            <div class="fg g2" v-if="needsBaseUrl(providerOf(String(editingModel.provider)))">
              <span class="microlabel">Base URL</span>
              <input v-model="editingModel.baseUrl" type="text" placeholder="https://…/api/paas/v4" />
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

        <button @click="editingModel = { provider: 'openai-compatible' }">＋ 新增模型配置</button>
        <div class="info-note">
          {{ keyringStatus || "钥匙串诊断中…" }} ·
          Key 通过系统安全存储保存；日志与错误信息不含完整 Key。
        </div>
      </div>

      <!-- 3.2 Categories -->
      <div class="set-sec">
        <div class="sec-head">
          <span class="n">3.2</span><h2>Review Categories 审阅类别</h2>
          <span class="hint">每类独立 Prompt · 修改互不影响（PRD §15–17 §45）</span>
        </div>

        <div v-for="(c, i) in [...settings.categories].sort((a, b) => a.order - b.order)" :key="c.id" class="cat-set-row">
          <div class="csr-top">
            <span class="csq" :style="{ background: c.color ?? 'var(--gray)' }"></span>
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
    </div>
  </section>
</template>
