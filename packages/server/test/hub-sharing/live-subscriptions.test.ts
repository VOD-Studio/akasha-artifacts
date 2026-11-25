import { on, once } from 'node:events'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PROTOCOL_VERSION, RealtimeServerEventSchema } from '@akasha/protocol'
import { expect, it } from 'vitest'
import WebSocket from 'ws'
import { startNodeHub } from '../../src/entry/hub-node.js'
import { browserClient, origin, sandboxOrigin } from './browser-client.js'
import { githubProvider } from './github-provider.js'

const during = async <T>(stage: string, operation: Promise<T>) => {
  try {
    return await operation
  } catch (cause) {
    throw new Error(stage, { cause })
  }
}

it('真实 WebSocket 在退组后停止下发已订阅作品的版本，并拒绝再次订阅', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'akasha-live-grant-'))
  const provider = githubProvider()
  try {
    await writeFile(join(dir, 'index.html'), '<html><head></head></html>')
    const server = await startNodeHub({
      host: '127.0.0.1',
      port: 0,
      webDir: dir,
      dbPath: join(dir, 'hub.sqlite'),
      origin,
      sandboxOrigin,
      oauth: provider.oauth,
    })
    try {
      const address = server.server.address()
      if (!address || typeof address === 'string') throw new Error('Hub 未绑定端口')
      const { send, login, publish, invite } = browserClient(server.app.fetch)
      const owner = await login('owner')
      const member = await login('member')
      const work = await publish(owner, 'live-access')
      await invite(work.path, owner, { kind: 'group', slug: 'design' })
      const subscribe = JSON.stringify({
        v: PROTOCOL_VERSION,
        type: 'subscribe',
        artifactId: work.id,
        lastSeq: 0,
      })
      const connect = async (cookie: string) => {
        const socket = new WebSocket(
          `ws://127.0.0.1:${address.port}/api/v1/ws?artifactId=${work.id}`,
          {
            headers: { cookie, origin },
            handshakeTimeout: 3000,
          },
        )
        await once(socket, 'open', { signal: AbortSignal.timeout(3000) })
        return socket
      }
      const observer = await during('所有者建立连接', connect(owner))
      const collaborator = await during('受邀者建立连接', connect(member))
      const versions: number[] = []
      collaborator.on('message', (raw) => {
        const event = RealtimeServerEventSchema.parse(JSON.parse(String(raw)))
        if (event.type === 'version.created') versions.push(event.version.version)
      })
      const replay = async (socket: WebSocket) => {
        const messages = on(socket, 'message', { signal: AbortSignal.timeout(3000) })
        socket.send(subscribe)
        let version: number | undefined
        for await (const [raw] of messages) {
          const event = RealtimeServerEventSchema.parse(JSON.parse(String(raw)))
          if (event.type === 'version.created') version = event.version.version
          // 初次邀请也会发布元数据。先完整消费它，再改变组成员资格。
          if (event.type === 'artifact.metadata') break
        }
        expect(version).toBe(1)
      }
      await Promise.all([
        during('所有者接收初次订阅', replay(observer)),
        during('受邀者接收初次订阅', replay(collaborator)),
      ])
      const closed = once(collaborator, 'close', { signal: AbortSignal.timeout(5000) })
      provider.groups.get('design')?.delete('member')
      const delivered = on(observer, 'message', { signal: AbortSignal.timeout(3000) })
      expect(
        (
          await send(work.path, 'PATCH', owner, {
            baseVersion: 1,
            edits: [{ old_str: '第一稿', new_str: '退组后的新设计' }],
          })
        ).status,
      ).toBe(200)
      const nextVersion = async () => {
        for await (const [raw] of delivered) {
          const event = RealtimeServerEventSchema.parse(JSON.parse(String(raw)))
          if (event.type === 'version.created') return event.version.version
        }
      }
      expect(await during('所有者接收第二版', nextVersion())).toBe(2)
      collaborator.send(subscribe)
      expect((await during('受邀者在订阅被拒绝后断开', closed))[0]).toBe(4403)
      expect(versions).toEqual([1])

      // 所有者显式撤回时，已打开的页面无需再订阅即可收到拒绝通知。
      provider.groups.get('design')?.add('member')
      const reopened = await connect(member)
      await replay(reopened)
      const revoked = once(reopened, 'close', { signal: AbortSignal.timeout(3000) })
      expect((await send(`${work.path}/sharing/only-me`, 'POST', owner, {})).status).toBe(200)
      expect((await during('所有者撤回后通知现有连接', revoked))[0]).toBe(4403)
    } finally {
      await server.close()
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}, 15_000)
