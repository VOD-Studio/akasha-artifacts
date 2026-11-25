import type { SqlStatement } from '../types.js'

/** 旧制品没有范围行时仍继承原可见性；不回填旧链接，也不改生命周期代数。 */
export const hubSharingSchema: SqlStatement[] = [
  [
    `CREATE TABLE IF NOT EXISTS hub_sharing_defaults (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      external_links INTEGER NOT NULL CHECK (external_links IN (0, 1)),
      external_email INTEGER NOT NULL CHECK (external_email IN (0, 1))
    )`,
  ],
  [
    `CREATE TABLE IF NOT EXISTS hub_sharing_scopes (
      artifact_id TEXT PRIMARY KEY NOT NULL REFERENCES artifacts(public_id) ON DELETE CASCADE,
      restricted INTEGER NOT NULL DEFAULT 0 CHECK (restricted IN (0, 1)),
      external_links INTEGER CHECK (external_links IN (0, 1)),
      external_email INTEGER CHECK (external_email IN (0, 1))
    )`,
  ],
  [
    `CREATE TABLE IF NOT EXISTS hub_sharing_grants (
      id TEXT PRIMARY KEY NOT NULL,
      artifact_id TEXT NOT NULL REFERENCES hub_sharing_scopes(artifact_id) ON DELETE CASCADE,
      generation INTEGER NOT NULL CHECK (generation >= 0),
      target_kind TEXT NOT NULL CHECK (target_kind IN ('member', 'email', 'organization', 'group', 'link')),
      target_value TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('view', 'comment', 'edit')),
      expires_at TEXT NOT NULL,
      subject_id TEXT,
      accepted_user_id TEXT,
      entry_json TEXT NOT NULL,
      CHECK ((target_kind IN ('member', 'organization', 'group')) = (subject_id IS NOT NULL)),
      CHECK (accepted_user_id IS NULL OR target_kind = 'email'
        OR (target_kind = 'member' AND accepted_user_id = subject_id))
    )`,
  ],
  [
    'CREATE INDEX IF NOT EXISTS idx_hub_sharing_grants_scope ON hub_sharing_grants (artifact_id, generation)',
  ],
  [
    `CREATE TABLE IF NOT EXISTS hub_identity_secrets (
      user_id TEXT PRIMARY KEY NOT NULL,
      ciphertext TEXT NOT NULL
    )`,
  ],
  [
    `CREATE TABLE IF NOT EXISTS hub_identity_email_keys (
      user_id TEXT NOT NULL REFERENCES hub_identity_secrets(user_id) ON DELETE CASCADE,
      email_key TEXT NOT NULL,
      PRIMARY KEY (user_id, email_key)
    )`,
  ],
  ['CREATE INDEX IF NOT EXISTS idx_hub_identity_email_key ON hub_identity_email_keys (email_key)'],
]
