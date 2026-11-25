import type {
  HubGrant,
  HubSharingRepository,
  HubSharingScope,
} from '../../../domain/hub-sharing.js'
import { defaultHubSharingPolicy, inheritedHubSharingOverride } from '../hub-sharing-policy.js'

const copyScope = (scope?: HubSharingScope): HubSharingScope => ({
  restricted: scope?.restricted ?? false,
  override: { ...(scope?.override ?? inheritedHubSharingOverride) },
})

/** 单个内存容器独占授权状态；所有读改写均在同一同步片段完成。 */
export function createMemoryHubSharingRepository(): HubSharingRepository {
  let defaults = { ...defaultHubSharingPolicy }
  const scopes = new Map<string, HubSharingScope>()
  const grants = new Map<string, HubGrant>()
  const identities = new Map<string, { ciphertext: string; keys: Set<string> }>()
  const usersByEmailKey = new Map<string, Set<string>>()
  const ensureScope = (id: string) => {
    let scope = scopes.get(id)
    if (!scope) {
      scope = copyScope()
      scopes.set(id, scope)
    }
    return scope
  }

  return {
    async getDefaults() {
      return { ...defaults }
    },
    async setDefaults(policy) {
      defaults = { ...policy }
    },
    async getScope(artifactId) {
      return copyScope(scopes.get(artifactId))
    },
    async getScopes(artifactIds) {
      const matches = new Map<string, HubSharingScope>()
      for (const id of artifactIds) {
        const scope = scopes.get(id)
        if (scope) matches.set(id, copyScope(scope))
      }
      return matches
    },
    async setOverride(artifactId, override) {
      ensureScope(artifactId).override = { ...override }
    },
    async restrictToOwner(artifactId) {
      ensureScope(artifactId).restricted = true
      for (const [id, grant] of grants) {
        if (grant.artifactId === artifactId) grants.delete(id)
      }
    },
    async createGrant(grant) {
      if (grants.has(grant.id)) throw new Error('授权标识已存在')
      grants.set(grant.id, structuredClone(grant))
      const scope = ensureScope(grant.artifactId)
      if (grant.target.kind !== 'link') scope.restricted = true
    },
    async listGrants(artifactId, generation) {
      const matches: HubGrant[] = []
      for (const grant of grants.values()) {
        if (grant.artifactId === artifactId && grant.generation === generation) {
          matches.push(structuredClone(grant))
        }
      }
      return matches
    },
    async getGrant(id) {
      const grant = grants.get(id)
      return grant && structuredClone(grant)
    },
    async acceptGrant(id, userId) {
      const grant = grants.get(id)
      if (!grant || (grant.target.kind !== 'member' && grant.target.kind !== 'email')) return false
      if (grant.target.kind === 'member' && grant.subjectId !== userId) return false
      if (grant.acceptedUserId !== null) return grant.acceptedUserId === userId
      grant.acceptedUserId = userId
      return true
    },
    async changeRole(artifactId, id, role) {
      const grant = grants.get(id)
      if (!grant || grant.artifactId !== artifactId) return false
      grant.role = role
      return true
    },
    async revokeGrant(artifactId, id) {
      return grants.get(id)?.artifactId === artifactId && grants.delete(id)
    },
    async saveIdentitySecret(userId, ciphertext, emailKeys) {
      const keys = new Set(emailKeys)
      const previous = identities.get(userId)
      if (previous) {
        for (const key of previous.keys) {
          if (keys.has(key)) continue
          const users = usersByEmailKey.get(key)
          users?.delete(userId)
          if (users?.size === 0) usersByEmailKey.delete(key)
        }
      }
      for (const key of keys) {
        const users = usersByEmailKey.get(key)
        if (users) users.add(userId)
        else usersByEmailKey.set(key, new Set([userId]))
      }
      identities.set(userId, { ciphertext, keys })
    },
    async getIdentitySecret(userId) {
      return identities.get(userId)?.ciphertext
    },
    async findIdentityByEmailKey(key) {
      return [...(usersByEmailKey.get(key) ?? [])]
    },
  }
}
