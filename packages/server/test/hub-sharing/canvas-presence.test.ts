import { once } from 'node:events'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ArtifactSchema, PROTOCOL_VERSION as v } from '@akasha/protocol'
import { expect, it, vi } from 'vitest'
import WebSocket from 'ws'
import { z } from 'zod'
import { startNodeHub } from '../../src/entry/hub-node.js'
import { browserClient, origin, sandboxOrigin } from './browser-client.js'
import { githubProvider } from './github-provider.js'

const shareResponse = z.object({ url: z.url() })

const next = (socket: WebSocket) =>
  once(socket, 'message', { signal: AbortSignal.timeout(3000) }).then(([raw]) =>
    JSON.parse(String(raw)),
  )

it('同页编辑者互见真实身份和画布坐标；换页、断线与重连不回放旧位置', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'akasha-canvas-presence-'))
  vi.useFakeTimers({ toFake: ['Date'] })
  try {
    await writeFile(join(directory, 'index.html'), '<html><head></head></html>')
    const provider = githubProvider()
    const directoryFetch = vi.fn(provider.oauth.fetch)
    const hub = await startNodeHub({
      host: '127.0.0.1',
      port: 0,
      webDir: directory,
      dbPath: join(directory, 'hub.sqlite'),
      origin,
      sandboxOrigin,
      oauth: { ...provider.oauth, fetch: directoryFetch },
    })
    try {
      const { login, send, link } = browserClient(hub.app.fetch)
      const [owner, member, guest] = await Promise.all(['owner', 'member', 'guest'].map(login))
      const publish = async (slug: string, visibility = 'private') => {
        const response = await send('/api/v1/artifacts', 'POST', owner, {
          slug,
          visibility,
          type: 'artboard',
          title: slug,
          source: JSON.stringify({ boards: [{ id: 'first', title: '第一稿' }] }),
        })
        expect(response.status).toBe(201)
        const {
          artifact: { publicId: id },
        } = z.object({ artifact: ArtifactSchema }).parse(await response.json())
        return { id, path: `/api/v1/artifacts/${id}` }
      }
      const work = await publish('shared-canvas', 'team')
      const other = await publish('other-canvas', 'team')
      const address = hub.server.address()
      if (!address || typeof address === 'string') throw new Error('Hub 未绑定端口')
      const connect = (cookie: string, artifactId = work.id, pageId = 'overview') => {
        const params = new URLSearchParams({ channel: 'canvas-presence', artifactId, pageId })
        return new WebSocket(`ws://127.0.0.1:${address.port}/api/v1/ws?${params}`, {
          headers: { cookie, origin },
        })
      }
      const joinRoom = async (cookie: string, artifactId?: string, pageId?: string) => {
        const socket = connect(cookie, artifactId, pageId)
        expect(await next(socket)).toEqual({ v, type: 'cursor.ready' })
        return socket
      }
      const alice = await joinRoom(owner)
      const bob = await joinRoom(member)
      const elsewhere = await joinRoom(owner, other.id)
      const anotherPage = await joinRoom(member, work.id, 'details')
      const unrelated: string[] = []
      for (const socket of [elsewhere, anotherPage]) {
        socket.on('message', (raw) => unrelated.push(String(raw)))
      }
      const move = (socket: WebSocket, x: number) => {
        socket.send(JSON.stringify({ v, type: 'cursor.move', x, y: -50, login: 'fake' }))
      }
      const bobsPosition = next(alice)
      move(bob, 100)
      const bobCursor = await bobsPosition
      expect(bobCursor).toEqual({
        v,
        type: 'cursor.moved',
        peerId: expect.any(String),
        login: 'member',
        x: 100,
        y: -50,
      })
      const alicesPosition = next(bob)
      move(alice, 42)
      expect(await alicesPosition).toMatchObject({ type: 'cursor.moved', login: 'owner', x: 42 })
      const departure = next(alice)
      bob.terminate()
      expect(await departure).toEqual({ v, type: 'cursor.left', peerId: bobCursor.peerId })
      const rejoined = await joinRoom(member)
      const onlyFresh = next(rejoined)
      move(alice, 300)
      expect(await onlyFresh).toMatchObject({ type: 'cursor.moved', x: 300 })
      directoryFetch.mockClear()
      for (let batch = 0; batch < 3; batch++) {
        const frame = next(rejoined)
        for (let x = 0; x <= 100; x++) move(alice, x)
        expect(await frame).toMatchObject({ type: 'cursor.moved', x: 100 })
      }
      expect(directoryFetch).not.toHaveBeenCalled()
      provider.organization.delete('member')
      vi.setSystemTime(Date.now() + 5000)
      const leftTeam = once(rejoined, 'close', { signal: AbortSignal.timeout(3000) })
      move(alice, 502)
      expect((await leftTeam)[0]).toBe(4403)
      // 两个账户各重读一次资料和组织资格，不随突发的 303 个指针事件放大。
      expect(directoryFetch).toHaveBeenCalledTimes(4)
      expect(unrelated).toEqual([])
      expect(await (await send(work.path, 'GET', owner)).json()).toMatchObject({
        artifact: { headVersion: 1 },
      })

      const privateWork = await publish('restricted-canvas')
      const denied = async (cookie: string, artifactId = privateWork.id) => {
        const socket = connect(cookie, artifactId)
        const messages: string[] = []
        socket.on('message', (raw) => messages.push(String(raw)))
        expect((await once(socket, 'close', { signal: AbortSignal.timeout(3000) }))[0]).toBe(4403)
        expect(messages).toEqual([])
      }
      await denied(member)
      const publicWork = await publish('readable-canvas', 'public')
      await denied(guest, publicWork.id)
      for (const input of [
        { role: 'view', entry: { kind: 'artifact' } },
        { role: 'view', entry: { kind: 'version', version: 1 } },
      ]) {
        const response = await send(`${privateWork.path}/share`, 'POST', owner, input)
        expect(response.status).toBe(201)
        const cookie = (await send(shareResponse.parse(await response.json()).url)).headers
          .get('set-cookie')
          ?.split(';')[0]
        if (!cookie) throw new Error('缺少分享凭证')
        await denied(cookie)
      }
      const bearer = await link(privateWork.path, owner)
      const holder = await joinRoom(`${guest}; ${bearer.cookie}`, privateWork.id)
      const observer = await joinRoom(owner, privateWork.id)
      const anonymous = next(observer)
      move(holder, 158)
      expect(await anonymous).toEqual({
        v,
        type: 'cursor.moved',
        peerId: expect.any(String),
        login: null,
        x: 158,
        y: -50,
      })
      const revoked = once(holder, 'close', { signal: AbortSignal.timeout(3000) })
      const afterLink: string[] = []
      holder.on('message', (raw) => afterLink.push(String(raw)))
      expect((await send(`${privateWork.path}/sharing/only-me`, 'POST', owner, {})).status).toBe(
        200,
      )
      move(observer, 680)
      expect((await revoked)[0]).toBe(4403)
      expect(afterLink).toEqual([])
      const timed = await send(`${privateWork.path}/share`, 'POST', owner, {
        role: 'edit',
        entry: { kind: 'artifact' },
        ttlSeconds: 1,
      })
      expect(timed.status).toBe(201)
      const redeemed = await send(shareResponse.parse(await timed.json()).url)
      const timedCookie = redeemed.headers.get('set-cookie')?.split(';')[0]
      if (!timedCookie) throw new Error('缺少限时分享凭证')
      const limited = await joinRoom(timedCookie, privateWork.id)
      const expired = once(limited, 'close', { signal: AbortSignal.timeout(3000) })
      const afterExpiry: string[] = []
      limited.on('message', (raw) => afterExpiry.push(String(raw)))
      vi.setSystemTime(Date.now() + 1000)
      move(observer, 870)
      expect((await expired)[0]).toBe(4403)
      expect(afterExpiry).toEqual([])
    } finally {
      await hub.close()
    }
  } finally {
    vi.useRealTimers()
    await rm(directory, { recursive: true, force: true })
  }
}, 20_000)
