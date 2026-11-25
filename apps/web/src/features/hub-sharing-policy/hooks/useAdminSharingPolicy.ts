import type { HubAdminSharingPolicy } from '@akasha/protocol'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { hubSessionOptions } from '@/entities/hub-session'
import { isAccessDenied } from '@/shared/api/error'
import {
  adminSharingOptions,
  putAdminSharingDefaults,
  putAdminSharingOverride,
} from '../api/policy'
import { applyPolicyPatch, type PolicyPatch } from '../lib/policy'

const sessionKey = hubSessionOptions().queryKey

/**
 * 管理页编排：确认 admin 会话后才读取策略；写请求乐观回填、失败回滚到服务端值。
 * 全程只经由会话与 admin 端点，不请求作品内容。
 */
export function useAdminSharingPolicy(artifactId: string) {
  const queryClient = useQueryClient()
  const session = useQuery(hubSessionOptions())
  const admin = session.data?.user?.admin === true
  const options = adminSharingOptions(artifactId)
  const policy = useQuery({ ...options, enabled: admin })
  const save = useMutation({
    mutationFn: (patch: PolicyPatch) =>
      'defaults' in patch
        ? putAdminSharingDefaults(artifactId, patch.defaults)
        : putAdminSharingOverride(artifactId, patch.override),
    onMutate: async (patch) => {
      await queryClient.cancelQueries({ queryKey: options.queryKey })
      const previous = queryClient.getQueryData<HubAdminSharingPolicy>(options.queryKey)
      if (previous) queryClient.setQueryData(options.queryKey, applyPolicyPatch(previous, patch))
      return { previous }
    },
    onSuccess: (next) => {
      queryClient.setQueryData(options.queryKey, next)
    },
    onError: (error, _patch, context) => {
      if (context?.previous) queryClient.setQueryData(options.queryKey, context.previous)
      // 401/403 可能意味着会话失效或被撤管理：重读身份，让页面回到登录或无权限反馈。
      if (isAccessDenied(error)) void queryClient.invalidateQueries({ queryKey: sessionKey })
    },
  })
  return { session, policy, save }
}
