import type { SqlStatement } from './types.js'

export const schema: SqlStatement[] = [
  [
    `CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY NOT NULL,
      root_path TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      last_active_at TEXT NOT NULL
    )`,
  ],
  [
    `CREATE TABLE IF NOT EXISTS artifacts (
      public_id TEXT PRIMARY KEY NOT NULL,
      project_id TEXT NOT NULL,
      slug TEXT NOT NULL,
      title TEXT NOT NULL,
      type TEXT NOT NULL,
      visibility TEXT NOT NULL,
      head_version INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (project_id, slug)
    )`,
  ],
  ['CREATE INDEX IF NOT EXISTS idx_artifacts_project ON artifacts (project_id, updated_at DESC)'],
  [
    `CREATE TABLE IF NOT EXISTS versions (
      artifact_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      parent_version INTEGER,
      author TEXT NOT NULL,
      title TEXT NOT NULL,
      source_json TEXT,
      blob_key TEXT,
      created_at TEXT NOT NULL,
      CHECK ((source_json IS NULL) <> (blob_key IS NULL)),
      PRIMARY KEY (artifact_id, version)
    )`,
  ],
  [
    `CREATE TABLE IF NOT EXISTS state_snapshots (
      artifact_id TEXT PRIMARY KEY NOT NULL,
      seq INTEGER NOT NULL,
      snapshot_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
  ],
  [
    `CREATE TABLE IF NOT EXISTS state_patches (
      artifact_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      ops_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (artifact_id, seq)
    )`,
  ],
  [
    `CREATE TABLE IF NOT EXISTS rounds (
      id TEXT PRIMARY KEY NOT NULL,
      artifact_id TEXT NOT NULL,
      ord INTEGER NOT NULL,
      status TEXT NOT NULL,
      groups_json TEXT NOT NULL,
      submitted_at TEXT,
      created_at TEXT NOT NULL
    )`,
  ],
  ['CREATE INDEX IF NOT EXISTS idx_rounds_artifact ON rounds (artifact_id, ord)'],
  [
    `CREATE TABLE IF NOT EXISTS feedbacks (
      id TEXT PRIMARY KEY NOT NULL,
      artifact_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      round_id TEXT,
      group_id TEXT,
      kind TEXT NOT NULL,
      element_json TEXT,
      body TEXT NOT NULL,
      author TEXT NOT NULL,
      draft INTEGER NOT NULL,
      status TEXT NOT NULL,
      insertion_seq BIGINT NOT NULL UNIQUE,
      delivery_seq BIGINT UNIQUE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
  ],
  ['CREATE INDEX IF NOT EXISTS idx_feedbacks_artifact ON feedbacks (artifact_id, delivery_seq)'],
  ['CREATE INDEX IF NOT EXISTS idx_feedbacks_round ON feedbacks (artifact_id, round_id, draft)'],
  [
    `CREATE TABLE IF NOT EXISTS receipts (
      receipt TEXT PRIMARY KEY NOT NULL,
      artifact_id TEXT,
      cursor TEXT NOT NULL,
      feedback_ids_json TEXT NOT NULL,
      issued_at TEXT NOT NULL
    )`,
  ],
  [
    `CREATE TABLE IF NOT EXISTS artifact_kv (
      namespace TEXT PRIMARY KEY NOT NULL,
      revision INTEGER NOT NULL,
      json TEXT NOT NULL
    )`,
  ],
]
