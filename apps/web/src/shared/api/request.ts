import { ErrorEnvelopeSchema } from '@akasha/protocol'
import { getApiBaseUrl } from '../config/runtime'
import { ApiError } from './error'

/**
 * 请求 Daemon 或 Hub 的 JSON 端点。未配置 API 根地址时与工作台同源，默认携带 Cookie。
 *
 * @param path - 带前导 `/` 的 API 路径；端点函数负责编码路径参数和查询参数。
 * @param init - 原生 Fetch 选项；JSON 请求体由调用方序列化，可用 `signal` 中止。
 * @returns 成功响应的 JSON；此层不校验端点字段，不用于下载文件或读取流。
 * @throws 非 2xx 响应抛出 `ApiError`；网络错误与中止原样传递。不重试，也不触发登录。
 */
export async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${getApiBaseUrl()}${path}`
  const headers = new Headers(init?.headers)
  if (init?.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  const res = await fetch(url, {
    credentials: 'include',
    ...init,
    headers,
  })
  const text = await res.text()
  let parsed: unknown
  try {
    parsed = text ? JSON.parse(text) : undefined
  } catch {
    parsed = undefined
  }
  if (!res.ok) {
    const errEnv = ErrorEnvelopeSchema.safeParse(parsed)
    if (errEnv.success) {
      throw new ApiError(
        res.status,
        errEnv.data.error.code,
        errEnv.data.error.message,
        errEnv.data.error.details,
      )
    }
    throw new ApiError(res.status, 'HTTP_ERROR', `请求失败（HTTP ${res.status}）`)
  }
  return parsed as T
}
