import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { PROTOCOL_VERSION, type RealtimeServerEvent, runContractTests } from '@akasha/protocol'
import { afterEach, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
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

    const report = await runContractTests({ baseUrl: srv.baseUrl, suite: 'full' })
    expect(report.cases.filter((c) => !c.passed)).toEqual([])
    expect(report.passed).toBe(true)
  })

  it('passes full protocol contract suite on node:sqlite storage adapter', async () => {
    const srv = await startNodeServer({ dbPath: ':memory:', port: 0 })
    closers.push(srv.close)

    const report = await runContractTests({ baseUrl: srv.baseUrl, suite: 'full' })
    expect(report.cases.filter((c) => !c.passed)).toEqual([])
    expect(report.passed).toBe(true)
  })

  it('persists projects, versions, state stream, rounds, and feedbacks across SQLite restarts', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'akasha-sqlite-'))
    tempDirs.push(dir)
    const dbPath = path.join(dir, 'akasha.db')

    const srv1 = await startNodeServer({ dbPath, port: 0 })
    const projRes = await fetch(`${srv1.baseUrl}/api/v1/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rootPath: '/repo/demo', name: 'demo' }),
    })
    expect(projRes.status).toBe(201)
    const { project } = (await projRes.json()) as { project: { id: string } }

    const pubRes = await fetch(`${srv1.baseUrl}/api/v1/artifacts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
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
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ patch: [{ op: 'add', path: '/progress', value: 80 }] }),
    })

    await fetch(`${srv1.baseUrl}/api/v1/artifacts/${artifact.publicId}/feedback`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        version: 1,
        kind: 'comment',
        element: { blockId: 'p1' },
        body: '重启后仍应存在',
        author: 'human:sun',
      }),
    })

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
  })

  it('enforces local security boundary (Host, Origin, Bearer token)', async () => {
    const srv = await startNodeServer({
      dbPath: 'memory',
      port: 0,
      security: {
        token: 'secret-tok',
        allowedOrigins: ['http://127.0.0.1:24321'],
      },
    })
    closers.push(srv.close)

    // 无令牌写操作 -> 401
    const unauth = await fetch(`${srv.baseUrl}/api/v1/artifacts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        slug: 'html/a',
        title: 'A',
        type: 'html',
        source: '<p>a</p>',
      }),
    })
    expect(unauth.status).toBe(401)

    // 跨站 Origin -> 403
    const badOrigin = await fetch(`${srv.baseUrl}/api/v1/artifacts`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer secret-tok',
        origin: 'https://evil.example',
      },
      body: JSON.stringify({
        slug: 'html/a',
        title: 'A',
        type: 'html',
        source: '<p>a</p>',
      }),
    })
    expect(badOrigin.status).toBe(403)

    // 合法令牌 -> 201
    const ok = await fetch(`${srv.baseUrl}/api/v1/artifacts`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer secret-tok',
      },
      body: JSON.stringify({
        slug: 'html/a',
        title: 'A',
        type: 'html',
        source: '<p>a</p>',
      }),
    })
    expect(ok.status).toBe(201)
  })
})

describe('Static check gate & on-demand spec', () => {
  it('detects duplicate blockIds, SVG scripts, and invalid JSON templates', async () => {
    const srv = await startNodeServer({ dbPath: 'memory', port: 0 })
    closers.push(srv.close)

    const dupDoc = await fetch(`${srv.baseUrl}/api/v1/artifacts/check`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
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
      headers: { 'content-type': 'application/json' },
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
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'artboard',
        source: JSON.stringify({ groups: [] }),
      }),
    })
    const abRes = (await badArtboard.json()) as { ok: boolean; errors: Array<{ code: string }> }
    expect(abRes.ok).toBe(false)
    expect(abRes.errors.some((e) => e.code === 'MISSING_REQUIRED_FIELD')).toBe(true)
  })
})

describe('WebSocket realtime catch-up, resync, and long-poll await', () => {
  it('replays missed events in order on reconnect via lastSeq and emits resync when window exceeded', async () => {
    const srv = await startNodeServer({ dbPath: 'memory', port: 0, maxEventHistory: 3 })
    closers.push(srv.close)

    const { artifact } = await srv.service.publish({
      slug: 'live-timeline/ws',
      title: 'WS Demo',
      type: 'live-timeline',
      source: '{"steps":[]}',
      author: 'agent:claude',
    })

    // 首次连接并订阅
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
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: artifact.publicId, timeoutSec: 5 }),
    }).then((r) => r.json() as Promise<{ status: string; items: Array<{ body: string }> }>)

    // 50ms 后在浏览器端提交批注，应立刻唤醒 long-poll
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
