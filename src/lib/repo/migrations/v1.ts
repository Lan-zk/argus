// schema v1 建库迁移（design D2 表结构；tasks 1.2）。
// 全部语句幂等（IF NOT EXISTS / OR IGNORE），配合「user_version 最后写」实现原子等效
// （tasks 1.3 定稿：方案 B——tauri-plugin-sql 基于 sqlx 连接池，JS 侧无法保证跨语句连接亲和，
// 事务不可靠；幂等可重放达到等效效果，spec 措辞「原子生效（…或经幂等可重放步骤达到等效效果）」）。
// 时间戳统一 ISO-8601 TEXT（与领域类型一致，字符串序即时序）。

import type { Migration } from "./index";

/** 按条拆分（tauri-plugin-sql 单次 execute 仅接受单条语句）。 */
const STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS model_configs (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    display_name TEXT,
    base_url TEXT,
    keyring_ref TEXT,
    is_default INTEGER NOT NULL DEFAULT 0,
    extra_json TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS categories (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    en TEXT,
    description TEXT,
    color TEXT,
    prompt TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    default_selected INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0,
    current_version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS category_prompt_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    version INTEGER NOT NULL,
    source TEXT NOT NULL,
    prompt TEXT NOT NULL,
    skill_meta TEXT,
    created_at TEXT NOT NULL,
    UNIQUE (category_id, version)
  )`,
  `CREATE TABLE IF NOT EXISTS app_prefs (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS rounds (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    number INTEGER NOT NULL,
    status TEXT NOT NULL,
    category_snapshot TEXT NOT NULL,
    model_snapshot TEXT NOT NULL,
    config_changed INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    UNIQUE (project_id, number)
  )`,
  `CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    round_id TEXT NOT NULL UNIQUE REFERENCES rounds(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    source_meta TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS document_blocks (
    document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    seq INTEGER NOT NULL,
    type TEXT NOT NULL,
    raw_text TEXT NOT NULL,
    plain_text TEXT NOT NULL,
    line INTEGER NOT NULL,
    PRIMARY KEY (document_id, seq)
  )`,
  `CREATE TABLE IF NOT EXISTS runs (
    id TEXT PRIMARY KEY,
    round_id TEXT NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
    category_id TEXT NOT NULL,
    category_version INTEGER NOT NULL,
    model_config_id TEXT,
    status TEXT NOT NULL,
    error TEXT,
    degraded INTEGER,
    retries INTEGER,
    started_at TEXT,
    completed_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS findings (
    id TEXT PRIMARY KEY,
    round_id TEXT NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
    run_id TEXT NOT NULL REFERENCES runs(id),
    category_id TEXT NOT NULL,
    severity TEXT NOT NULL,
    title TEXT NOT NULL,
    quote TEXT NOT NULL,
    line_hint INTEGER,
    content_hash TEXT,
    line INTEGER,
    block_seq INTEGER,
    start_offset INTEGER,
    end_offset INTEGER,
    problem TEXT NOT NULL,
    reason TEXT NOT NULL,
    suggestion TEXT NOT NULL,
    anchor_status TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_findings_round ON findings(round_id)`,
  `CREATE INDEX IF NOT EXISTS idx_findings_hash ON findings(content_hash)`,
  `CREATE TABLE IF NOT EXISTS reports (
    round_id TEXT PRIMARY KEY REFERENCES rounds(id) ON DELETE CASCADE,
    summary TEXT NOT NULL,
    priority_finding_ids TEXT NOT NULL,
    category_summaries TEXT NOT NULL,
    failed_category_ids TEXT NOT NULL DEFAULT '[]',
    degraded INTEGER,
    generated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS finding_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    prev_finding_id TEXT NOT NULL REFERENCES findings(id) ON DELETE CASCADE,
    curr_round_id TEXT NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
    link_type TEXT NOT NULL,
    curr_finding_id TEXT REFERENCES findings(id),
    confidence REAL,
    computed_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_links_round ON finding_links(curr_round_id)`,
  `CREATE INDEX IF NOT EXISTS idx_links_prev ON finding_links(prev_finding_id)`,
];

export const v1: Migration = {
  toVersion: 1,
  up: async (db) => {
    for (const sql of STATEMENTS) {
      await db.exec(sql);
    }
  },
};
