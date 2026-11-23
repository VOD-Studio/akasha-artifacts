import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PROTOCOL_VERSION, RealtimeServerEventSchema } from '@akasha/protocol'
import { Pool } from 'pg'
import { expect, it } from 'vitest'
import WebSocket from 'ws'
import { startNodeHub } from '../src/entry/hub-node.js'

const postgresUrl = process.env.AKASHA_TEST_POSTGRES_URL

function boundOrigin(hub: Awaited<ReturnType<typeof startNodeHub>>): string {
  const address = hub.server.address()
  if (!address || typeof address === 'string') throw new Error('Hub 未绑定 TCP 端口')
  return `http://127.0.0.1:${address.port}`
}

async function firstEvent(
  hub: Awaited<ReturnType<typeof startNodeHub>>,
  artifactId: string,
  lastSeq: number,
) {
  const url = new URL(`/api/v1/ws?artifactId=${artifactId}`, boundOrigin(hub))
  url.protocol = 'ws:'
  const socket = new WebSocket(url, { handshakeTimeout: 5_000 })
  const signal = AbortSignal.timeout(5_000)
  try {
    await once(socket, 'open', { signal })
    const message = once(socket, 'message', { signal })
    socket.send(JSON.stringify({ v: PROTOCOL_VERSION, type: 'subscribe', artifactId, lastSeq }))
    const [raw] = await message
    return RealtimeServerEventSchema.parse(JSON.parse(String(raw)))
  } finally {
    socket.close()
  }
}

async function checkReconnectAfterRestart(connectionString?: string) {
  const dir = await mkdtemp(join(tmpdir(), 'akasha-hub-realtime-'))
  try {
    await writeFile(join(dir, 'index.html'), '<html><head></head><body></body></html>')
    const start = () =>
      startNodeHub({
        host: '127.0.0.1',
        port: 0,
        origin: 'https://hub.example.com',
        sandboxOrigin: 'https://preview.example.net',
        webDir: dir,
        dbPath: join(dir, 'hub.sqlite'),
        connectionString,
        oauth: {
          clientId: 'hub-realtime-test',
          clientSecret: 'unused-test-oauth-secret',
          signingSecret: 'hub-realtime-test-signing-secret-only',
        },
      })
    const publish = {
      projectId: 'project-realtime',
      slug: 'restart-canvas',
      type: 'html',
      title: '重连画布',
      visibility: 'public',
      author: 'agent:test',
    } as const
    const before = await start()
    let id: string
    let cursor: number
    try {
      const { artifact } = await before.service.publish({ ...publish, source: '<main>v1</main>' })
      id = artifact.publicId
      const version = await firstEvent(before, id, 0)
      expect(version).toMatchObject({ type: 'version.created', version: { version: 1 } })
      cursor = version.seq
    } finally {
      await before.close()
    }

    const after = await start()
    try {
      const source = '<main>重启后发布的版本</main>'
      await after.service.publish({ ...publish, source, baseVersion: 1 })
      const event = await firstEvent(after, id, cursor)
      expect(event).toMatchObject({ type: 'resync', artifactId: id })
      expect(event.seq).toBeGreaterThan(cursor)
      const detail = await fetch(`${boundOrigin(after)}/api/v1/artifacts/${id}`)
      expect(await detail.json()).toMatchObject({ version: { version: 2, source } })
    } finally {
      await after.close()
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

it('Hub 使用 SQLite 重启后，旧游标收到 resync 并可重新拉取头版本', async () => {
  await checkReconnectAfterRestart()
}, 15_000)

it.skipIf(!postgresUrl)(
  'Hub 使用 PostgreSQL 重启后，旧游标收到 resync 并可重新拉取头版本',
  async () => {
    if (!postgresUrl) throw new Error('未配置测试数据库')
    const pool = new Pool({ connectionString: postgresUrl })
    const schema = `akasha_hub_replay_${randomUUID().replaceAll('-', '')}`
    const connectionString = new URL(postgresUrl)
    connectionString.searchParams.set('options', `-c search_path=${schema}`)
    try {
      await pool.query(`CREATE SCHEMA ${schema}`)
      await checkReconnectAfterRestart(connectionString.href)
    } finally {
      try {
        await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`)
      } finally {
        await pool.end()
      }
    }
  },
  15_000,
)
