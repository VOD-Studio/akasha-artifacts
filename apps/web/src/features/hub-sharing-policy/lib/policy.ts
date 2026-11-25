import type { HubAdminSharingPolicy, HubSharingOverride, HubSharingPolicy } from '@akasha/protocol'

/** 一次写请求只改一组设置；另一组保持服务端当前值。 */
export type PolicyPatch = { defaults: HubSharingPolicy } | { override: HubSharingOverride }

/** 乐观回填与响应回填共用的合并规则：补丁只覆盖自己那组字段。 */
export function applyPolicyPatch(
  current: HubAdminSharingPolicy,
  patch: PolicyPatch,
): HubAdminSharingPolicy {
  return 'defaults' in patch
    ? { ...current, defaults: patch.defaults }
    : { ...current, override: patch.override }
}

/** 例外三态在界面上的选项值；`inherit` 对应继承 Hub 默认。 */
export type PolicyOption = 'inherit' | 'allow' | 'deny'

/** 未知选项按继承处理；选项值只由本切片渲染。 */
export function parsePolicyOption(value: string): PolicyOption {
  return value === 'allow' || value === 'deny' ? value : 'inherit'
}

export function overrideToOption(value: boolean | null): PolicyOption {
  if (value === null) return 'inherit'
  return value ? 'allow' : 'deny'
}

export function optionToOverride(option: PolicyOption): boolean | null {
  if (option === 'inherit') return null
  return option === 'allow'
}
