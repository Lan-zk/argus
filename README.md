# Argus — AI Document Review

English · **[简体中文](./README-zh.md)**

A personal-use AI document-review desktop app (MVP). Paste a manuscript → pick review categories → run parallel AI reviews per category → see anchored highlights and annotations on the original text → get a summary report.

Tech stack: **Tauri v2 + Vue 3 + TypeScript + Pinia + Vite**. The AI runtime is `@earendil-works/pi-ai`, running inside the WebView; model requests are sent through the Tauri HTTP plugin from the Rust side (no CORS). The requirements baseline lives in [产品需求说明书](./产品需求说明书.md) (Chinese); specifications live under [`openspec/`](./openspec/README.md).

## Features

- **Parallel multi-category review** — 6 default-enabled categories (logic / thesis / argument / rhetoric / structure / clarity) plus 1 default-disabled one (speech delivery). Each category's prompt is independently editable in Settings; a single category can be re-run without touching the others.
- **Three-signal anchoring** — *line number + quoted content + hash*. The quote returned by the model is normalized and searched across the document, ambiguous candidates are disambiguated via `lineHint`, and the anchor is verified with a djb2 8-hex-digit hash. No single signal is trusted on its own. Findings that cannot be anchored are kept as *unanchored* (shown in the right pane, not highlighted in the text).
- **Two-pane workspace** — highlighted original text on the left, finding cards on the right, each pane scrolling independently; filter by category and severity.
- **Summary report** — generated automatically once all categories finish: prioritized issues plus per-category summaries, all traceable to concrete findings.
- **Model configuration** — 34 preset providers (DeepSeek / Kimi / Zhipu / MiniMax / Alibaba Qwen / OpenAI / Anthropic / Google / OpenRouter, …) where you only paste an API key; any OpenAI-compatible endpoint (including local Ollama / LM Studio) via custom connection; model-list discovery and a test-connection probe.
- **Secure storage** — API keys are stored in the **macOS Keychain**; data files only keep references, never plaintext.
- **Theme system** — two design languages (Swiss / Apple) × light/dark = 4 combinations (spec: theme-system).
- **Category colors** — fixed colors for built-in categories plus a 10-color palette for custom ones, with WCAG contrast checks (spec: category-colors).
- **First-run onboarding** — a guide layer on first launch (spec: onboarding-first-run).
- **Restart recovery** — the latest review's text, findings, and report are persisted and restored after restart.

## Getting Started

Requirements: Node ≥ 22, Rust (stable), macOS (Xcode Command Line Tools).

```bash
npm install
npm run tauri dev     # dev mode: compile and open the app window
```

Frontend-only debugging (browser, no Tauri shell):

```bash
npm run dev           # http://localhost:1420; persistence & keychain fall back to in-memory
```

## Test & Build

```bash
npm run test          # vitest: full unit / component / integration suite
cargo test            # Rust-side tests (incl. macOS keychain round-trip)
npm run tauri build   # produces .app and .dmg
```

Build artifacts:

- `src-tauri/target/release/bundle/macos/Argus.app`
- `src-tauri/target/release/bundle/dmg/Argus_0.1.0_aarch64.dmg`

Releases: pushing a `v*` tag triggers the [GitHub Actions workflow](./.github/README.md), which builds a macOS (arm64 / x64 `.dmg`), Windows (NSIS / MSI), and Linux (`.deb` / `.AppImage`) matrix and opens a draft release. Assets include minisign-signed updater artifacts and `latest.json`; in-app auto-update only sees the new version **after you manually publish the draft** — publishing is the switch that turns updates on for users (spec: app-updates).

## Configuring a Model

1. Open **Settings → Models → + New model config**.
2. Pick a provider and fill in:

| Field | Notes |
| --- | --- |
| Provider | OpenAI / Anthropic / Google / OpenAI-compatible |
| Model Name | e.g. `gpt-4o`, `claude-sonnet-4-5`, `glm-4.7` |
| API Key | Stored in the **macOS Keychain** (data files keep only a reference); the only required field for preset providers |
| Base URL | Only for custom connections (e.g. `https://open.bigmodel.cn/api/paas/v4`); presets have it built in |
| Temperature / Max Tokens / Context Window | Optional; Context Window drives long-document degradation |

3. Recommended: pick a **preset provider** → paste just the **API key** → leave the field to auto-discover the model list (offline static catalog + recommended default) → choose a model from the dropdown. Adding a second model for the same service reuses the stored key.
4. Any OpenAI-compatible endpoint (including local Ollama / LM Studio) goes through **custom connection**: fill Base URL + key, then use “fetch models” or type a model ID manually.
5. Click **Test connection**: success shows model info; failure shows a readable error with next-step suggestions.
6. Back in **New Review**: paste the text (≤ 30,000 characters) → check categories → **Start review**.

## Architecture Overview

```
src/               # frontend (Vue 3 + TypeScript) — every subfolder has its own README
src-tauri/         # Rust shell: http / store plugins + keychain commands
design/            # design docs: module/data-flow diagram, interaction prototype, icon sources
docs/              # integration verification records & known issues
openspec/          # spec-driven development: main specs, change proposals, archive
scripts/           # dev scripts: mock model server, contrast checker
public/            # Vite public static assets (app icon)
.github/           # CI: multi-platform release workflow
.agents/           # openspec workflow skills (for AI agents)
```

See the README in each folder for details:

| Folder | Responsibility |
| --- | --- |
| [`src/domain/`](./src/domain/README.md) | Pure-function domain core: parsing, three-signal anchoring, normalization, dedup, prompt assembly, error classification |
| [`src/ai/`](./src/ai/README.md) | pi-ai wrapper: provider factory, submit_findings tool, auto-repair, retry, test connection, long-text degradation |
| [`src/orchestrator/`](./src/orchestrator/README.md) | concurrency pool, session state machine, single-category rerun, report generation |
| [`src/stores/`](./src/stores/README.md) | Pinia: settings / session / ui / theme / onboarding |
| [`src/pages/`](./src/pages/README.md) | the three pages: NewReview / Workspace / Settings |
| [`src/components/`](./src/components/README.md) | DocViewer (block rendering + overlapping highlights), FindingCard, ReportView, OnboardingLayer, CategoryColorPicker |
| [`src/lib/`](./src/lib/README.md) | Tauri env & fetch channel, keychain wrapper, persistence (plugin-store), theme application, contrast |
| [`src/styles/`](./src/styles/README.md) | design tokens (theme × light/dark, four combinations; migrated from the design/02 prototype and the Apple design analysis) |
| [`src-tauri/src/`](./src-tauri/src/README.md) | Rust shell: keychain commands and plugin registration |
| [`src-tauri/capabilities/`](./src-tauri/capabilities/README.md) | Tauri permission scopes (HTTP allowlist, store) |
| [`src-tauri/icons/`](./src-tauri/icons/README.md) | full app icon set (generated by `tauri icon`) |

## Known Limitations (MVP)

- End-to-end integration was verified in-app against a local OpenAI-compatible endpoint (see [`docs/known-issues.md`](./docs/known-issues.md)). Before connecting to real cloud services (OpenAI / Anthropic / Google, …), confirm with “Test connection” under Settings → Models; macOS may prompt for Keychain authorization on first GUI access.
- Out of scope: multi-review history, streaming token-by-token rendering, project/version management, fact-checking (PRD §4, §70).
