import { ArtifactSchema, CheckResultSchema, VersionSchema } from './domain.js'
import {
  DaemonStatusSchema,
  ErrorEnvelopeSchema,
  HealthResponseSchema,
  VersionConflictDetailsSchema,
} from './http.js'
import {
  ArtifactAckFeedbackOutputSchema,
  ArtifactPullFeedbackOutputSchema,
  ArtifactSpecOutputSchema,
} from './mcp.js'

export interface ContractTestOptions {
  baseUrl: string
  token?: string
  fetchImpl?: typeof fetch
  // 'core' 仅测基础健康与错误信封；'full' 执行完整 CRUD、冲突、状态流与反馈回执契约
  suite?: 'core' | 'full'
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
export async function runContractTests(options: ContractTestOptions): Promise<ContractTestReport> {
  const fetchFn = options.fetchImpl ?? fetch
  const baseUrl = options.baseUrl.replace(/\/+$/, '')
  const suite = options.suite ?? 'full'
  const baseHeaders: Record<string, string> = {
    'content-type': 'application/json',
    ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
  }

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
    const res = await fetchFn(`${baseUrl}/api/v1/health`, { headers: baseHeaders })
    if (res.status !== 200) throw new Error(`期望 HTTP 200，实际收到 ${res.status}`)
    HealthResponseSchema.parse(await res.json())
  })

  await runCase('GET 未知资源返回统一 ErrorEnvelope(NOT_FOUND)', async () => {
    const res = await fetchFn(`${baseUrl}/api/v1/artifacts/NonExistentArtifact0000`, {
      headers: baseHeaders,
    })
    if (res.status !== 404) throw new Error(`期望 HTTP 404，实际收到 ${res.status}`)
    const parsed = ErrorEnvelopeSchema.parse(await res.json())
    if (parsed.error.code !== 'NOT_FOUND') {
      throw new Error(`期望错误码 NOT_FOUND，实际收到 ${parsed.error.code}`)
    }
  })

  if (suite === 'core') {
    return { baseUrl, passed: cases.every((c) => c.passed), cases }
  }

  let publicId = ''

  await runCase('GET /api/v1/daemon/status 与 /specs/react 返回合法契约', async () => {
    const sRes = await fetchFn(`${baseUrl}/api/v1/daemon/status`, { headers: baseHeaders })
    if (sRes.status !== 200) throw new Error(`status 期望 200，实际 ${sRes.status}`)
    DaemonStatusSchema.parse(await sRes.json())

    const specRes = await fetchFn(`${baseUrl}/api/v1/specs/react`, { headers: baseHeaders })
    if (specRes.status !== 200) throw new Error(`spec 期望 200，实际 ${specRes.status}`)
    ArtifactSpecOutputSchema.parse(await specRes.json())
  })

  await runCase('POST /api/v1/artifacts/check 拦截非法依赖', async () => {
    const res = await fetchFn(`${baseUrl}/api/v1/artifacts/check`, {
      method: 'POST',
      headers: baseHeaders,
      body: JSON.stringify({
        type: 'react',
        source: "import fs from 'node:fs'\nexport default () => null",
      }),
    })
    if (res.status !== 200) throw new Error(`期望 200，实际 ${res.status}`)
    const check = CheckResultSchema.parse(await res.json())
    if (check.ok || !check.errors.some((e) => e.code === 'DISALLOWED_IMPORT')) {
      throw new Error('期望检测到 DISALLOWED_IMPORT 错误')
    }
  })

  await runCase('POST /api/v1/artifacts 发布、增量更新与 409 VERSION_CONFLICT', async () => {
    const createRes = await fetchFn(`${baseUrl}/api/v1/artifacts`, {
      method: 'POST',
      headers: baseHeaders,
      body: JSON.stringify({
        project: 'contract-proj',
        slug: 'html/contract-demo',
        title: 'Contract Demo',
        type: 'html',
        source: '<h1>v1</h1>\n<p>hello</p>',
        author: 'agent:contract',
      }),
    })
    if (createRes.status !== 201) throw new Error(`新建期望 201，实际 ${createRes.status}`)
    const created = (await createRes.json()) as { artifact: unknown; version: unknown }
    const artifact = ArtifactSchema.parse(created.artifact)
    VersionSchema.parse(created.version)
    publicId = artifact.publicId

    const patchRes = await fetchFn(`${baseUrl}/api/v1/artifacts/${publicId}`, {
      method: 'PATCH',
      headers: baseHeaders,
      body: JSON.stringify({
        baseVersion: 1,
        edits: [{ old_str: '<h1>v1</h1>', new_str: '<h1>v2</h1>' }],
        author: 'human:tester',
      }),
    })
    if (patchRes.status !== 200) throw new Error(`更新期望 200，实际 ${patchRes.status}`)

    // 落后 baseVersion=1 触发 409 并附带 diff 与 authors
    const conflictRes = await fetchFn(`${baseUrl}/api/v1/artifacts`, {
      method: 'POST',
      headers: baseHeaders,
      body: JSON.stringify({
        project: 'contract-proj',
        slug: 'html/contract-demo',
        title: 'Stale',
        type: 'html',
        source: '<h1>stale</h1>',
        baseVersion: 1,
        author: 'agent:contract',
      }),
    })
    if (conflictRes.status !== 409) throw new Error(`冲突期望 409，实际 ${conflictRes.status}`)
    const env = ErrorEnvelopeSchema.parse(await conflictRes.json())
    if (env.error.code !== 'VERSION_CONFLICT') throw new Error(`错误码不对：${env.error.code}`)
    const details = VersionConflictDetailsSchema.parse(env.error.details)
    if (details.headVersion !== 2 || !details.authors.includes('human:tester')) {
      throw new Error('冲突详情缺少 headVersion 或人类作者')
    }
  })

  await runCase('POST/GET /api/v1/artifacts/:id/state 支持 RFC 6902 与按 seq 回放', async () => {
    const r1 = await fetchFn(`${baseUrl}/api/v1/artifacts/${publicId}/state`, {
      method: 'POST',
      headers: baseHeaders,
      body: JSON.stringify({ patch: [{ op: 'add', path: '/step', value: 1 }] }),
    })
    if (r1.status !== 200) throw new Error(`seq1 期望 200，实际 ${r1.status}`)

    const r2 = await fetchFn(`${baseUrl}/api/v1/artifacts/${publicId}/state`, {
      method: 'POST',
      headers: baseHeaders,
      body: JSON.stringify({ patch: [{ op: 'replace', path: '/step', value: 2 }] }),
    })
    if (r2.status !== 200) throw new Error(`seq2 期望 200，实际 ${r2.status}`)

    const replayRes = await fetchFn(`${baseUrl}/api/v1/artifacts/${publicId}/state?seq=1`, {
      headers: baseHeaders,
    })
    const replayed = (await replayRes.json()) as { seq: number; snapshot: { step?: number } }
    if (replayed.seq !== 1 || replayed.snapshot.step !== 1) {
      throw new Error(`按 seq=1 回放结果错误：${JSON.stringify(replayed)}`)
    }
  })

  await runCase('反馈提交、拉取与凭 receipt ack 闭环', async () => {
    const fbRes = await fetchFn(`${baseUrl}/api/v1/artifacts/${publicId}/feedback`, {
      method: 'POST',
      headers: baseHeaders,
      body: JSON.stringify({
        version: 2,
        kind: 'comment',
        element: { loc: '1:1' },
        body: '文字改大一点',
        author: 'human:tester',
      }),
    })
    if (fbRes.status !== 201) throw new Error(`提交反馈期望 201，实际 ${fbRes.status}`)

    const pullRes = await fetchFn(`${baseUrl}/api/v1/feedback?id=${publicId}&detail=true`, {
      headers: baseHeaders,
    })
    const pulled = ArtifactPullFeedbackOutputSchema.parse(await pullRes.json())
    if (pulled.items.length !== 1 || !pulled.receipt) {
      throw new Error('拉取反馈未返回完整条目或 receipt')
    }

    const ackRes = await fetchFn(`${baseUrl}/api/v1/feedback/ack`, {
      method: 'POST',
      headers: baseHeaders,
      body: JSON.stringify({
        receipt: pulled.receipt,
        resolveIds: [pulled.items[0]?.id],
      }),
    })
    const acked = ArtifactAckFeedbackOutputSchema.parse(await ackRes.json())
    if (acked.acknowledged !== 1 || acked.resolved !== 1) {
      throw new Error(`ack 计数不符：${JSON.stringify(acked)}`)
    }
  })

  return {
    baseUrl,
    passed: cases.every((c) => c.passed),
    cases,
  }
}
