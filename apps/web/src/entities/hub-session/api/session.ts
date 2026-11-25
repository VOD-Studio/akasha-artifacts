import { queryOptions } from '@tanstack/react-query'
import { requestJson } from '@/shared/api/request'
import { isCloudHub } from '@/shared/config/runtime'

interface HubSession {
  /** 账号可登录但不属于 Hub；管理员不因身份获得作品读取权。 */
  user: {
    userId: string
    login: string
    kind: 'session' | 'cli'
    member: boolean
    admin: boolean
  } | null
}

/** 账号入口、邀请和策略页共享同源身份；只据此展示入口，具体授权以业务端点为准。 */
export function hubSessionOptions() {
  return queryOptions({
    queryKey: ['hub-session'],
    enabled: isCloudHub(),
    staleTime: 60_000,
    queryFn: ({ signal }) =>
      requestJson<HubSession>('/api/v1/auth/session', { signal }, 'workbench'),
  })
}
