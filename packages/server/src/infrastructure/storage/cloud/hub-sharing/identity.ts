import type { HubIdentityStore } from '../../../../domain/hub-sharing.js'
import type { SqlDriver, SqlStatement } from '../types.js'

/** 密文行的 upsert 先锁住该账号，再在同一事务内替换其所有邮箱键。 */
export function createSqlIdentityStore(
  execute: SqlDriver['execute'],
  batch: (statements: SqlStatement[]) => Promise<void>,
  jsonArrayValues: string,
): HubIdentityStore {
  return {
    async saveIdentitySecret(userId, ciphertext, emailKeys) {
      await batch([
        [
          `INSERT INTO hub_identity_secrets (user_id, ciphertext) VALUES (?, ?)
           ON CONFLICT (user_id) DO UPDATE SET ciphertext = excluded.ciphertext`,
          userId,
          ciphertext,
        ],
        ['DELETE FROM hub_identity_email_keys WHERE user_id = ?', userId],
        [
          `INSERT INTO hub_identity_email_keys (user_id, email_key)
           SELECT DISTINCT ?, value FROM ${jsonArrayValues}`,
          userId,
          JSON.stringify(emailKeys),
        ],
      ])
    },
    async getIdentitySecret(userId) {
      const [row] = await execute<{ ciphertext: string }>([
        'SELECT ciphertext FROM hub_identity_secrets WHERE user_id = ?',
        userId,
      ])
      return row?.ciphertext
    },
    async findIdentityByEmailKey(key) {
      const rows = await execute<{ user_id: string }>([
        'SELECT user_id FROM hub_identity_email_keys WHERE email_key = ? ORDER BY user_id',
        key,
      ])
      return rows.map((row) => row.user_id)
    },
  }
}
