import { getMessages, type Messages } from '../i18n/messages'

/** 服务端的非 2xx 响应；`code` 是协议错误码，响应体不是错误信封时为 `HTTP_ERROR`。 */
export class ApiError extends Error {
  readonly status: number
  readonly code: string
  /** 例如 `VERSION_CONFLICT` 的基准版本；使用前按错误码验证形状。 */
  readonly details?: unknown

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
  }
}

/** 当前身份不能读取或写入该资源；不把暂时性的连接失败视为撤权。 */
export function isAccessDenied(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 401 || error.status === 403)
}

/** 当前访问范围下，重试同一地址无法恢复已撤权、删除或失效的资源。 */
export function isResourceUnavailable(error: unknown): boolean {
  return (
    isAccessDenied(error) ||
    (error instanceof ApiError && (error.status === 404 || error.status === 410))
  )
}

const messages = {
  请先登录: ['Bitte zuerst anmelden.', 'سجّل الدخول أولًا.', 'Sign in first.'],
  没有权限执行此操作: [
    'Für diese Aktion fehlt die Berechtigung.',
    'ليس لديك إذن بتنفيذ هذا الإجراء.',
    'You do not have permission to perform this action.',
  ],
  找不到请求的内容: [
    'Der angeforderte Inhalt wurde nicht gefunden.',
    'تعذّر العثور على المحتوى المطلوب.',
    'The requested content could not be found.',
  ],
  内容已变更: [
    'Der Inhalt wurde zwischenzeitlich geändert.',
    'تغيّر المحتوى منذ فتحه.',
    'The content has changed.',
  ],
  内容已不可用: [
    'Der Inhalt steht nicht mehr zur Verfügung.',
    'لم يعد المحتوى متاحًا.',
    'This content is no longer available.',
  ],
  请求过于频繁: [
    'Zu viele Anfragen. Bitte später erneut versuchen.',
    'عدد الطلبات كبير. حاول لاحقًا.',
    'Too many requests. Try again later.',
  ],
  服务暂不可用: [
    'Der Dienst ist vorübergehend nicht verfügbar.',
    'الخدمة غير متاحة مؤقتًا.',
    'The service is temporarily unavailable.',
  ],
  无法连接服务: [
    'Keine Verbindung zum Dienst.',
    'تعذّر الاتصال بالخدمة.',
    'Cannot connect to the service.',
  ],
  请求失败: ['Die Anfrage ist fehlgeschlagen.', 'تعذّر تنفيذ الطلب.', 'The request failed.'],
} as const satisfies Messages

/** 保留服务端诊断；已知 HTTP 状态对其他语言给出可读的恢复信息。 */
export function getRequestErrorMessage(error: unknown, fallback?: string): string {
  const { t, locale } = getMessages(messages)
  if (error instanceof ApiError && locale !== 'zh-CN') {
    switch (error.status) {
      case 401:
        return t('请先登录')
      case 403:
        return t('没有权限执行此操作')
      case 404:
        return t('找不到请求的内容')
      case 409:
        return t('内容已变更')
      case 410:
        return t('内容已不可用')
      case 429:
        return t('请求过于频繁')
    }
    if (error.status >= 500) return t('服务暂不可用')
  }
  if (error instanceof TypeError && /fetch|network|load failed/i.test(error.message))
    return t('无法连接服务')
  return error instanceof Error && error.message ? error.message : (fallback ?? t('请求失败'))
}
