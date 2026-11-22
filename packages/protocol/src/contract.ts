import { ErrorEnvelopeSchema, HealthResponseSchema } from './http.js'

export interface ContractTestOptions {
  baseUrl: string
  token?: string
  fetchImpl?: typeof fetch
}

export interface ContractCaseResult {
  name: string
  passed: boolean
  error?: string
}

export interface ContractTestReport {
  baseUrl: string
  passed: boolean
  cases: ContractCaseResult[]
}

// 协议契约测试框架：仅通过 HTTP 黑盒校验任意服务端实现是否符合 @akasha/protocol 契约。
// 随 M1/M2 接口落地逐步增补 artifacts / versions / state / feedback / WS 用例。
export async function runContractTests(options: ContractTestOptions): Promise<ContractTestReport> {
  const fetchFn = options.fetchImpl ?? fetch
  const baseUrl = options.baseUrl.replace(/\/+$/, '')
  const headers: Record<string, string> = options.token
    ? { authorization: `Bearer ${options.token}` }
    : {}

  const cases: ContractCaseResult[] = []

  async function runCase(name: string, fn: () => Promise<void>) {
    try {
      await fn()
      cases.push({ name, passed: true })
    } catch (err) {
      cases.push({
        name,
        passed: false,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  await runCase('GET /api/v1/health 返回合法 HealthResponse', async () => {
    const res = await fetchFn(`${baseUrl}/api/v1/health`, { headers })
    if (res.status !== 200) {
      throw new Error(`期望 HTTP 200，实际收到 ${res.status}`)
    }
    const json = await res.json()
    HealthResponseSchema.parse(json)
  })

  await runCase('GET 未知资源返回统一 ErrorEnvelope(NOT_FOUND)', async () => {
    const res = await fetchFn(`${baseUrl}/api/v1/artifacts/NonExistentArtifact0000`, { headers })
    if (res.status !== 404) {
      throw new Error(`期望 HTTP 404，实际收到 ${res.status}`)
    }
    const json = await res.json()
    const parsed = ErrorEnvelopeSchema.parse(json)
    if (parsed.error.code !== 'NOT_FOUND') {
      throw new Error(`期望错误码 NOT_FOUND，实际收到 ${parsed.error.code}`)
    }
  })

  return {
    baseUrl,
    passed: cases.every((c) => c.passed),
    cases,
  }
}
