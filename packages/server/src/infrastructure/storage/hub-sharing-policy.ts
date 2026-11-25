import type { HubSharingOverride, HubSharingPolicy } from '@akasha/protocol'

/** 尚未设置管理员策略的 Hub 继续提供普通链接，不自动允许外部邮箱。 */
export const defaultHubSharingPolicy: Readonly<HubSharingPolicy> = {
  externalLinks: true,
  externalEmail: false,
}

/** 没有制品例外时，每项均随管理员的当前默认值变化。 */
export const inheritedHubSharingOverride: Readonly<HubSharingOverride> = {
  externalLinks: null,
  externalEmail: null,
}
