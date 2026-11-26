import { randomUUID } from 'node:crypto'
import {
  type CanvasCursorEvent,
  CanvasCursorInputSchema,
  PROTOCOL_VERSION as v,
} from '@akasha/protocol'
import type { WSEvents } from 'hono/ws'
import type WebSocket from 'ws'

type Identity = { login: string | null }
/** 没有当前制品编辑权时返回 undefined；匿名持有者可以移动但没有账号标签。 */
export type AuthorizeCanvasPresence = (
  request: Request,
  artifactId: string,
) => Promise<Identity | undefined>

type Point = { x: number; y: number }
interface Peer {
  id: string
  socket: WebSocket
  joined: number
  authorize: () => Promise<Identity | undefined>
  pending?: Point & { revision: number }
  seen: Set<Peer>
}

function send(peer: Peer, event: CanvasCursorEvent) {
  if (peer.socket.readyState !== 1) return
  if (peer.socket.bufferedAmount > 64 * 1024) {
    peer.socket.close(1013, '光标连接积压')
    return
  }
  peer.socket.send(JSON.stringify(event))
}

class CursorRoom {
  readonly peers = new Set<Peer>()
  revision = 0
  private timer?: ReturnType<typeof setTimeout>
  private flushing = false

  hide(peer: Peer) {
    peer.pending = undefined
    for (const other of this.peers) {
      if (other.seen.delete(peer)) send(other, { v, type: 'cursor.left', peerId: peer.id })
    }
  }

  leave(peer: Peer) {
    this.peers.delete(peer)
    this.hide(peer)
    peer.seen.clear()
    if (!this.peers.size) {
      clearTimeout(this.timer)
      this.timer = undefined
    }
  }

  move(peer: Peer, point: Point) {
    if (this.peers.size < 2) return
    peer.pending = { ...point, revision: ++this.revision }
    this.schedule()
  }

  private schedule() {
    if (this.timer || this.flushing) return
    // 每页每 100ms 至多一批；新位置覆盖未发送位置，慢鉴权不会积出队列。
    this.timer = setTimeout(() => {
      this.timer = undefined
      void this.flush()
    }, 100)
  }

  private async flush() {
    this.flushing = true
    const members = [...this.peers]
    try {
      if (!members.some((peer) => peer.pending)) return
      const identities = await Promise.all(
        members.map((peer) => peer.authorize().catch(() => undefined)),
      )
      const allowed = new Map<Peer, Identity>()
      for (const [i, peer] of members.entries()) {
        if (!this.peers.has(peer) || peer.socket.readyState !== 1) continue
        const identity = identities[i]
        if (identity) allowed.set(peer, identity)
        else {
          this.leave(peer)
          peer.socket.close(4403, '没有画布协作权限')
        }
      }
      for (const [peer, identity] of allowed) {
        const point = peer.pending
        if (!point) continue
        peer.pending = undefined
        for (const other of allowed.keys()) {
          if (other === peer || other.joined > point.revision) continue
          other.seen.add(peer)
          send(other, {
            v,
            type: 'cursor.moved',
            peerId: peer.id,
            login: identity.login,
            x: point.x,
            y: point.y,
          })
        }
      }
    } finally {
      this.flushing = false
      for (const peer of this.peers) {
        if (peer.pending && peer.socket.readyState === 1) {
          this.schedule()
          break
        }
      }
    }
  }
}

/** 每个 Hub 进程独占房间；不向版本事件总线发布，不快照或回放先前坐标。 */
export function createCanvasPresenceRooms(authorize: AuthorizeCanvasPresence) {
  const rooms = new Map<string, CursorRoom>()
  return (request: Request): WSEvents<WebSocket> => {
    const params = new URL(request.url).searchParams
    const artifactId = params.get('artifactId') ?? ''
    const pageId = params.get('pageId')
    const key = JSON.stringify([artifactId, pageId])
    let room: CursorRoom | undefined
    let peer: Peer | undefined
    let heartbeat: ReturnType<typeof setInterval> | undefined
    return {
      onOpen(_event, ws) {
        const socket = ws.raw
        if (!socket || pageId === null || pageId.length > 512) {
          ws.close(4403, '没有画布协作权限')
          return
        }
        const check = () => authorize(request, artifactId)
        const join = async () => {
          const identity = await check().catch(() => undefined)
          if (socket.readyState !== 1) return
          if (!identity) {
            socket.close(4403, '没有画布协作权限')
            return
          }
          room = rooms.get(key) ?? new CursorRoom()
          rooms.set(key, room)
          peer = {
            id: randomUUID(),
            socket,
            joined: ++room.revision,
            authorize: check,
            seen: new Set(),
          }
          room.peers.add(peer)
          send(peer, { v, type: 'cursor.ready' })
          // TCP 半开时也须移除光标。浏览器原生回复 pong，不依赖后台标签页的 JS 定时器。
          let alive = true
          socket.on('pong', () => {
            alive = true
          })
          heartbeat = setInterval(() => {
            if (!alive) return socket.terminate()
            alive = false
            if (socket.readyState === 1) socket.ping()
          }, 20_000)
        }
        void join()
      },
      onMessage({ data }) {
        if (!room || !peer || typeof data !== 'string' || data.length > 512) return
        let raw: unknown
        try {
          raw = JSON.parse(data)
        } catch {
          return
        }
        const input = CanvasCursorInputSchema.safeParse(raw)
        if (!input.success) return
        if (input.data.type === 'cursor.hide') room.hide(peer)
        else room.move(peer, { x: input.data.x, y: input.data.y })
      },
      onClose() {
        clearInterval(heartbeat)
        if (!room || !peer) return
        room.leave(peer)
        if (!room.peers.size && rooms.get(key) === room) rooms.delete(key)
      },
    }
  }
}
