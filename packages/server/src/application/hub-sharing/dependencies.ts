import type { HubSharingRepository } from '../../domain/hub-sharing.js'
import type { ArtifactRepository, Clock, RealtimePublisher } from '../../domain/ports.js'
import type { HubIdentityAuthority } from './authority.js'

/** Hub 分享使用活动制品的代数与服务端时钟，不依赖请求携带的授权快照。 */
export interface HubSharingDependencies {
  repository: HubSharingRepository
  artifacts: ArtifactRepository
  auth: HubIdentityAuthority
  clock: Clock
  origin: string
  realtime: RealtimePublisher
}
