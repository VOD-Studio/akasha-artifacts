import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  ArtifactPullFeedbackOutputSchema,
  FeedbackSchema,
  PROTOCOL_VERSION,
  type RealtimeServerEvent,
  runContractTests,
} from '@akasha/protocol'
import { afterEach, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import { z } from 'zod'
import { startNodeServer } from '../src/entry/node.js'

const closers: Array<() => Promise<void>> = []
const tempDirs: string[] = []

afterEach(async () => {
  while (closers.length > 0) {
    const close = closers.pop()
    if (close) await close()
  }
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) fs.rmSync(dir, { recursive: true, force: true })
  }
})

function authHeaders(token: string): Record<string, string> {
  return {
    'content-type': 'application/json',
    authorization: `Bearer ${token}`,
  }
}

function connectWs(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url)
    ws.once('open', () => resolve(ws))
    ws.once('error', reject)
  })
}

function waitForEvent(
  ws: WebSocket,
  predicate: (ev: RealtimeServerEvent) => boolean,
  timeoutMs = 2000,
): Promise<RealtimeServerEvent> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('等待 WS 事件超时')), timeoutMs)
    const onMessage = (raw: WebSocket.RawData) => {
      const parsed = JSON.parse(String(raw)) as RealtimeServerEvent
      if (predicate(parsed)) {
        clearTimeout(timer)
        ws.off('message', onMessage)
        resolve(parsed)
      }
    }
    ws.on('message', onMessage)
  })
}

describe('Hono HTTP server & @akasha/protocol contract tests', () => {
  it('passes full protocol contract suite on Memory storage adapter', async () => {
    const srv = await startNodeServer({ dbPath: 'memory', port: 0 })
    closers.push(srv.close)

    const report = await runContractTests({
      baseUrl: srv.baseUrl,
      token: srv.token,
      suite: 'full',
    })
    expect(report.cases.filter((c) => !c.passed)).toEqual([])
    expect(report.passed).toBe(true)
  })

  it('passes full protocol contract suite on node:sqlite storage adapter', async () => {
    const srv = await startNodeServer({ dbPath: ':memory:', port: 0 })
    closers.push(srv.close)

    const report = await runContractTests({
      baseUrl: srv.baseUrl,
      token: srv.token,
      suite: 'full',
    })
    expect(report.cases.filter((c) => !c.passed)).toEqual([])
    expect(report.passed).toBe(true)
  })

  it('persists data across SQLite restarts and sends resync to reconnecting clients', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'akasha-sqlite-'))
    tempDirs.push(dir)
    const dbPath = path.join(dir, 'akasha.db')

    const srv1 = await startNodeServer({ dbPath, port: 0 })
    const projRes = await fetch(`${srv1.baseUrl}/api/v1/projects`, {
      method: 'POST',
      headers: authHeaders(srv1.token),
      body: JSON.stringify({ rootPath: '/repo/demo', name: 'demo' }),
    })
    expect(projRes.status).toBe(201)
    const { project } = (await projRes.json()) as { project: { id: string } }

    const pubRes = await fetch(`${srv1.baseUrl}/api/v1/artifacts`, {
      method: 'POST',
      headers: authHeaders(srv1.token),
      body: JSON.stringify({
        project: project.id,
        slug: 'document/arch',
        title: 'Arch',
        type: 'document',
        source: '<article><p id="p1">hello</p></article>',
        author: 'agent:claude',
      }),
    })
    const { artifact } = (await pubRes.json()) as { artifact: { publicId: string } }

    await fetch(`${srv1.baseUrl}/api/v1/artifacts/${artifact.publicId}/state`, {
      method: 'POST',
      headers: authHeaders(srv1.token),
      body: JSON.stringify({ patch: [{ op: 'add', path: '/progress', value: 80 }] }),
    })

    await fetch(`${srv1.baseUrl}/api/v1/artifacts/${artifact.publicId}/feedback`, {
      method: 'POST',
      headers: authHeaders(srv1.token),
      body: JSON.stringify({
        version: 1,
        kind: 'comment',
        element: { blockId: 'p1' },
        body: '重启后仍应存在',
        author: 'human:sun',
      }),
    })
    const seqBeforeRestart = srv1.realtime.getLatestSeq()
    await srv1.close()

    // 重启后用同一 SQLite 文件恢复
    const srv2 = await startNodeServer({ dbPath, port: 0 })
    closers.push(srv2.close)

    const getRes = await fetch(`${srv2.baseUrl}/api/v1/artifacts/${artifact.publicId}`)
    expect(getRes.status).toBe(200)
    const loaded = (await getRes.json()) as {
      artifact: { publicId: string; headVersion: number }
      state: { seq: number; snapshot: { progress: number } }
    }
    expect(loaded.artifact.publicId).toBe(artifact.publicId)
    expect(loaded.state.seq).toBe(1)
    expect(loaded.state.snapshot.progress).toBe(80)

    const fbRes = await fetch(`${srv2.baseUrl}/api/v1/feedback?id=${artifact.publicId}`)
    const fb = (await fbRes.json()) as { items: Array<{ body: string }> }
    expect(fb.items).toHaveLength(1)
    expect(fb.items[0]?.body).toBe('重启后仍应存在')

    // 重启后携带重启前的 lastSeq 重连 → 必须收到 resync，避免前端保留陈旧缓存
    const wsAfterRestart = await connectWs(srv2.wsUrl)
    const resyncPromise = waitForEvent(wsAfterRestart, (e) => e.type === 'resync')
    wsAfterRestart.send(
      JSON.stringify({
        v: PROTOCOL_VERSION,
        type: 'subscribe',
        artifactId: artifact.publicId,
        lastSeq: seqBeforeRestart,
      }),
    )
    const resync = await resyncPromise
    expect(resync.type).toBe('resync')
    wsAfterRestart.close()
  })

  it('enables local security boundary by default (Host, Origin, Content-Type, Bearer token)', async () => {
    // 不传 security 配置也必须默认启用全部本地安全边界
    const srv = await startNodeServer({ dbPath: 'memory', port: 0 })
    closers.push(srv.close)

    // 无令牌写操作 -> 401
    const unauth = await fetch(`${srv.baseUrl}/api/v1/artifacts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slug: 'html/a', title: 'A', type: 'html', source: '<p>a</p>' }),
    })
    expect(unauth.status).toBe(401)

    // 跨站 Origin -> 403
    const badOrigin = await fetch(`${srv.baseUrl}/api/v1/artifacts`, {
      method: 'POST',
      headers: {
        ...authHeaders(srv.token),
        origin: 'https://evil.example',
      },
      body: JSON.stringify({ slug: 'html/a', title: 'A', type: 'html', source: '<p>a</p>' }),
    })
    expect(badOrigin.status).toBe(403)

    // 非法 Host 头（模拟 DNS rebinding）-> 403
    const forgedHost = await srv.app.request('/api/v1/health', {
      headers: { host: 'evil.rebind.example:24321' },
    })
    expect(forgedHost.status).toBe(403)

    // text/plain 简单请求绕过 JSON Content-Type -> 400
    const textPlain = await fetch(`${srv.baseUrl}/api/v1/artifacts`, {
      method: 'POST',
      headers: {
        'content-type': 'text/plain',
        authorization: `Bearer ${srv.token}`,
      },
      body: JSON.stringify({ slug: 'html/a', title: 'A', type: 'html', source: '<p>a</p>' }),
    })
    expect(textPlain.status).toBe(400)

    // 合法令牌 + JSON -> 201
    const ok = await fetch(`${srv.baseUrl}/api/v1/artifacts`, {
      method: 'POST',
      headers: authHeaders(srv.token),
      body: JSON.stringify({ slug: 'html/a', title: 'A', type: 'html', source: '<p>a</p>' }),
    })
    expect(ok.status).toBe(201)
  })
})

describe('Static check gate & on-demand spec', () => {
  it('detects dynamic imports, duplicate blockIds, SVG scripts, invalid JSON, and allows @violetjs/inkline', async () => {
    const srv = await startNodeServer({ dbPath: 'memory', port: 0 })
    closers.push(srv.close)

    // 动态 import 非白名单依赖与非常量表达式都必须拦截
    const dynBad = await fetch(`${srv.baseUrl}/api/v1/artifacts/check`, {
      method: 'POST',
      headers: authHeaders(srv.token),
      body: JSON.stringify({
        type: 'react',
        source: "export default () => { void import('node:fs'); return import(pkgName) }",
      }),
    })
    const dynRes = (await dynBad.json()) as { ok: boolean; errors: Array<{ code: string }> }
    expect(dynRes.ok).toBe(false)
    expect(dynRes.errors.some((e) => e.code === 'DISALLOWED_IMPORT')).toBe(true)
    expect(dynRes.errors.some((e) => e.code === 'DYNAMIC_IMPORT_DISALLOWED')).toBe(true)

    // @violetjs/inkline 属于合法白名单依赖
    const inkOk = await fetch(`${srv.baseUrl}/api/v1/artifacts/check`, {
      method: 'POST',
      headers: authHeaders(srv.token),
      body: JSON.stringify({
        type: 'react',
        source:
          "import { gpen } from '@violetjs/inkline'\nexport default () => String(Boolean(gpen))",
      }),
    })
    const inkRes = (await inkOk.json()) as { ok: boolean; errors: unknown[] }
    expect(inkRes.ok).toBe(true)

    const dupDoc = await fetch(`${srv.baseUrl}/api/v1/artifacts/check`, {
      method: 'POST',
      headers: authHeaders(srv.token),
      body: JSON.stringify({
        type: 'document',
        source: '<article>\n<p id="b1">one</p>\n<p id="b1">two</p>\n</article>',
      }),
    })
    const dupRes = (await dupDoc.json()) as {
      ok: boolean
      errors: Array<{ code: string; line?: number }>
    }
    expect(dupRes.ok).toBe(false)
    expect(dupRes.errors[0]).toMatchObject({ code: 'DUPLICATE_BLOCK_ID', line: 3 })

    const badSvg = await fetch(`${srv.baseUrl}/api/v1/artifacts/check`, {
      method: 'POST',
      headers: authHeaders(srv.token),
      body: JSON.stringify({
        type: 'svg',
        source: '<svg><script>alert(1)</script></svg>',
      }),
    })
    const svgRes = (await badSvg.json()) as { ok: boolean; errors: Array<{ code: string }> }
    expect(svgRes.ok).toBe(false)
    expect(svgRes.errors.some((e) => e.code === 'DISALLOWED_SVG_SCRIPT')).toBe(true)

    const badArtboard = await fetch(`${srv.baseUrl}/api/v1/artifacts/check`, {
      method: 'POST',
      headers: authHeaders(srv.token),
      body: JSON.stringify({
        type: 'artboard',
        source: JSON.stringify({ groups: [] }),
      }),
    })
    const abRes = (await badArtboard.json()) as { ok: boolean; errors: Array<{ code: string }> }
    expect(abRes.ok).toBe(false)
    expect(abRes.errors.some((e) => e.code === 'MISSING_REQUIRED_FIELD')).toBe(true)

    // Kit 模板元素必填字段校验：与前端沙盒解析器契约保持一致
    for (const [type, source] of [
      ['live-timeline', JSON.stringify({ steps: [{ id: 's1' }] })],
      ['option-compare', JSON.stringify({ options: [{ id: 'o1' }] })],
      ['artboard', JSON.stringify({ boards: [{ id: 'b1' }] })],
      ['verify', JSON.stringify({ claims: [{ id: 'c1' }] })],
    ] as const) {
      const r = await fetch(`${srv.baseUrl}/api/v1/artifacts/check`, {
        method: 'POST',
        headers: authHeaders(srv.token),
        body: JSON.stringify({ type, source }),
      })
      const parsed = (await r.json()) as { ok: boolean; errors: Array<{ code: string }> }
      expect(parsed.ok).toBe(false)
      expect(parsed.errors.some((e) => e.code === 'MISSING_ITEM_TITLE')).toBe(true)
    }
  })
})

describe('WebSocket realtime catch-up, project routing, resync, and long-poll await', () => {
  it('routes artifact events to project-only subscribers, replays via lastSeq, and emits resync when window exceeded', async () => {
    const srv = await startNodeServer({ dbPath: 'memory', port: 0, maxEventHistory: 3 })
    closers.push(srv.close)

    // 仅订阅 projectId，也必须收到该项目下 Artifact 的 version.created 与 state.patched
    const wsProj = await connectWs(srv.wsUrl)
    try {
      const pongReady = new Promise<void>((resolve) => {
        const onMsg = (raw: WebSocket.RawData) => {
          const m = JSON.parse(String(raw)) as { type?: string }
          if (m.type === 'pong') {
            wsProj.off('message', onMsg)
            resolve()
          }
        }
        wsProj.on('message', onMsg)
      })
      wsProj.send(
        JSON.stringify({
          v: PROTOCOL_VERSION,
          type: 'subscribe',
          projectId: 'proj-stream',
        }),
      )
      wsProj.send(JSON.stringify({ v: PROTOCOL_VERSION, type: 'ping' }))
      await pongReady

      const projVersionPromise = waitForEvent(wsProj, (e) => e.type === 'version.created')
      const published = await srv.service.publish({
        projectId: 'proj-stream',
        slug: 'live-timeline/ws',
        title: 'WS Demo',
        type: 'live-timeline',
        source: '{"steps":[]}',
        author: 'agent:claude',
      })
      const projVersionEv = await projVersionPromise
      expect(projVersionEv.type === 'version.created' && projVersionEv.artifactId).toBe(
        published.artifact.publicId,
      )
    } finally {
      wsProj.close()
    }

    const artifact = await srv.service.resolveArtifact('live-timeline/ws', 'proj-stream')

    // 首次按 artifact 订阅
    const ws1 = await connectWs(srv.wsUrl)
    const presencePromise = waitForEvent(ws1, (e) => e.type === 'presence.changed')
    ws1.send(
      JSON.stringify({
        v: PROTOCOL_VERSION,
        type: 'subscribe',
        artifactId: artifact.publicId,
      }),
    )
    const firstPresence = await presencePromise
    const seqBeforeDisconnect = firstPresence.seq
    ws1.close()

    // 断线期间产生 2 条状态补丁（落在 maxEventHistory=3 窗口内）
    await srv.service.pushState({
      id: artifact.publicId,
      ops: [{ op: 'add', path: '/step', value: 1 }],
    })
    await srv.service.pushState({
      id: artifact.publicId,
      ops: [{ op: 'replace', path: '/step', value: 2 }],
    })

    // 带 lastSeq 重连 → 按序收到两条 state.patched 且不重复
    const ws2 = await connectWs(srv.wsUrl)
    const received: RealtimeServerEvent[] = []
    const caughtUp = new Promise<void>((resolve) => {
      ws2.on('message', (raw) => {
        const ev = JSON.parse(String(raw)) as RealtimeServerEvent
        if (ev.type === 'state.patched') {
          received.push(ev)
          if (received.length === 2) resolve()
        }
      })
    })
    ws2.send(
      JSON.stringify({
        v: PROTOCOL_VERSION,
        type: 'subscribe',
        artifactId: artifact.publicId,
        lastSeq: seqBeforeDisconnect,
      }),
    )
    await caughtUp
    expect(received.map((e) => (e.type === 'state.patched' ? e.stateSeq : -1))).toEqual([1, 2])
    ws2.close()

    // 继续产生 4 条事件撑爆 maxEventHistory=3 窗口，再用旧 lastSeq=1 重连 → 必须收到 resync
    for (let i = 3; i <= 6; i++) {
      await srv.service.pushState({
        id: artifact.publicId,
        ops: [{ op: 'replace', path: '/step', value: i }],
      })
    }
    const ws3 = await connectWs(srv.wsUrl)
    const resyncPromise = waitForEvent(ws3, (e) => e.type === 'resync')
    ws3.send(
      JSON.stringify({
        v: PROTOCOL_VERSION,
        type: 'subscribe',
        artifactId: artifact.publicId,
        lastSeq: 1,
      }),
    )
    const resync = await resyncPromise
    expect(resync.type).toBe('resync')
    ws3.close()
  })

  it.each(['memory', ':memory:'])('只把显式投递且已提交的批注列入回执（%s）', async (dbPath) => {
    const srv = await startNodeServer({ dbPath, port: 0 })
    closers.push(srv.close)
    const { artifact } = await srv.service.publish({
      slug: 'html/review-audience',
      title: '讨论与投递',
      type: 'html',
      source: '<p id="title">标题</p>',
      author: 'agent:review',
    })
    const id = artifact.publicId
    const round = await srv.service.openRound({
      id,
      groups: [{ id: 'design', title: '设计', kind: 'choose', options: ['A', 'B'] }],
    })
    const post = (path: string, input: unknown) =>
      fetch(`${srv.baseUrl}${path}`, {
        method: 'POST',
        headers: authHeaders(srv.token),
        body: JSON.stringify(input),
      })
    const get = async (path: string) => {
      const response = await fetch(`${srv.baseUrl}${path}`)
      expect(response.status).toBe(200)
      return response.json()
    }
    const readQueue = async (url: string) => ArtifactPullFeedbackOutputSchema.parse(await get(url))
    const reviewSchema = z.object({ items: z.array(FeedbackSchema) })
    const path = `/api/v1/artifacts/${id}/feedback`
    const queue = `/api/v1/feedback?id=${id}&includeDrafts=true`
    const element = { blockId: 'title' }
    async function comment(body: string, audience: 'human' | 'agent', roundId?: string) {
      const response = await post(path, {
        version: 1,
        element,
        kind: 'comment',
        body,
        audience,
        roundId,
      })
      expect(response.status).toBe(201)
      return z.object({ feedback: FeedbackSchema }).parse(await response.json()).feedback
    }

    const discussion = await comment('只供讨论', 'human')
    expect(await readQueue(queue)).toMatchObject({ items: [], cursor: '' })
    const requested = await comment('请修改', 'agent')
    const first = await readQueue(queue)
    expect(first.items).toMatchObject([{ id: requested.id, element }])
    expect(typeof first.receipt).toBe('string')
    const { cursor } = first
    const consume = await post('/api/v1/feedback/ack', {
      receipt: first.receipt,
      resolveIds: [discussion.id, requested.id],
    })
    expect(await consume.json()).toEqual({ acknowledged: 1, resolved: 1 })

    const humanDraft = await comment('本轮人类讨论', 'human', round.id)
    const agentDraft = await comment('本轮 Agent 修改', 'agent', round.id)
    const resume = `${queue}&after=${encodeURIComponent(cursor)}`
    expect(await readQueue(resume)).toMatchObject({ items: [], cursor })
    expect(reviewSchema.parse(await get(`${path}?includeDrafts=true`))).toEqual({
      items: expect.arrayContaining([
        expect.objectContaining({ id: discussion.id, status: 'pending', element }),
        expect.objectContaining({ id: requested.id, status: 'resolved', element }),
        expect.objectContaining({ id: humanDraft.id, draft: true, element }),
        expect.objectContaining({ id: agentDraft.id, draft: true, element }),
      ]),
    })
    await srv.service.submitRound({ id, roundId: round.id })
    expect((await readQueue(resume)).items).toMatchObject([{ id: agentDraft.id, draft: false }])
    expect(reviewSchema.parse(await get(path)).items).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: humanDraft.id, draft: false })]),
    )
  })

  it('wakes long-poll /api/v1/feedback/await immediately when feedback arrives', async () => {
    const srv = await startNodeServer({ dbPath: 'memory', port: 0 })
    closers.push(srv.close)

    const { artifact } = await srv.service.publish({
      slug: 'html/await-test',
      title: 'Await Test',
      type: 'html',
      source: '<p>wait</p>',
      author: 'agent:claude',
    })

    const awaitPromise = fetch(`${srv.baseUrl}/api/v1/feedback/await`, {
      method: 'POST',
      headers: authHeaders(srv.token),
      body: JSON.stringify({ id: artifact.publicId, timeoutSec: 5 }),
    }).then((r) => r.json() as Promise<{ status: string; items: Array<{ body: string }> }>)

    setTimeout(() => {
      void srv.service.submitFeedback({
        id: artifact.publicId,
        version: 1,
        kind: 'approve',
        body: '通过',
        author: 'human:sun',
      })
    }, 50)

    const result = await awaitPromise
    expect(result.status).toBe('received')
    expect(result.items).toHaveLength(1)
    expect(result.items[0]?.body).toBe('通过')
  })
})
