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
