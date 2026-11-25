import { ApiError } from '@/shared/api/error'
import { requestJson } from '@/shared/api/request'
import { getMessages } from '@/shared/i18n'
import { messages } from '../messages'

/** 让当前 Hub 清除登录 Cookie；仅成功后才由调用方清理草稿并重载。 */
export async function endHubSession(): Promise<void> {
  try {
    await requestJson('/api/v1/auth/logout', { method: 'POST' }, 'workbench')
  } catch (error) {
    if (error instanceof ApiError)
      throw new Error(getMessages(messages).t('退出失败'), { cause: error })
    throw error
  }
}
