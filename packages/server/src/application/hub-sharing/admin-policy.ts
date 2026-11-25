import type {
  Artifact,
  HubAdminSharingPolicy,
  HubSharingOverride,
  HubSharingPolicy,
} from '@akasha/protocol'
import type { HubSharingDependencies } from './dependencies.js'
import { notifySharingChanged } from './grant-state.js'

/** 默认策略变更只通知继承相关开关的活动制品，单制品例外不向其他制品广播。 */
export function createAdminSharingPolicy({
  repository,
  artifacts,
  realtime,
}: HubSharingDependencies) {
  const readPolicy = async (artifactId: string): Promise<HubAdminSharingPolicy> => {
    const [defaults, { override }] = await Promise.all([
      repository.getDefaults(),
      repository.getScope(artifactId),
    ])
    return { defaults, override }
  }

  const updatePolicy = async (
    artifact: Artifact,
    update: { defaults: HubSharingPolicy } | { override: HubSharingOverride },
  ) => {
    if ('defaults' in update) {
      const before = await repository.getDefaults()
      const linksChanged = update.defaults.externalLinks !== before.externalLinks
      const emailChanged = update.defaults.externalEmail !== before.externalEmail
      await repository.setDefaults(update.defaults)
      if (linksChanged || emailChanged) {
        const activeArtifacts = await artifacts.listByProject()
        const scopes = await repository.getScopes(activeArtifacts.map(({ publicId }) => publicId))
        for (const active of activeArtifacts) {
          const scope = scopes.get(active.publicId)
          if (
            !scope ||
            (linksChanged && scope.override.externalLinks === null) ||
            (emailChanged && scope.override.externalEmail === null)
          )
            await notifySharingChanged(realtime, active)
        }
      }
    } else {
      await repository.setOverride(artifact.publicId, update.override)
      await notifySharingChanged(realtime, artifact)
    }
    return readPolicy(artifact.publicId)
  }

  return { readPolicy, updatePolicy }
}
