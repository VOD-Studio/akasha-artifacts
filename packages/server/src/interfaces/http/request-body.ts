import type { z } from 'zod'
import { DomainError } from '../../domain/errors.js'

/** Content-Type、JSON 语法与 schema 校验的失败都归一为 BAD_REQUEST。 */
export async function parseJsonBody<T>(req: Request, schema: z.ZodType<T>): Promise<T> {
  const ct = req.headers.get('content-type')?.toLowerCase() ?? ''
  if (!ct.includes('application/json')) {
    throw new DomainError('BAD_REQUEST', 'Content-Type 必须为 application/json')
  }
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    throw new DomainError('BAD_REQUEST', '请求体必须是合法 JSON')
  }
  const result = schema.safeParse(raw)
  if (!result.success) {
    throw new DomainError('BAD_REQUEST', '请求参数校验失败', result.error.issues)
  }
  return result.data
}
