import { ApiError } from '@/shared/api/error'
import { requestJson } from '@/shared/api/request'

interface HubSession {
  /** 未登录时为 `null`；已登录也可能不是当前 Hub 的成员。 */
  user: { login: string; member: boolean } | null
}

/** 只问提供当前页面的 Hub；不能用登录回执推断作品的读取或管理权限。 */
export async function fetchHubSession(): Promise<HubSession> {
  try {
    return await requestJson('/api/v1/auth/session', undefined, 'workbench')
  } catch (error) {
    if (error instanceof ApiError) throw new Error('无法读取登录状态', { cause: error })
    throw error
  }
}

/** 让当前 Hub 清除登录 Cookie；仅成功后才由调用方清理草稿并重载。 */
export async function endHubSession(): Promise<void> {
  try {
    await requestJson('/api/v1/auth/logout', { method: 'POST' }, 'workbench')
  } catch (error) {
    if (error instanceof ApiError) throw new Error('退出失败', { cause: error })
    throw error
  }
}
