import {
  type CanvasCursorEvent,
  CanvasCursorEventSchema,
  type CanvasCursorInput,
  PROTOCOL_VERSION as v,
} from '@akasha/protocol'

export type CursorPosition = Extract<CanvasCursorEvent, { type: 'cursor.moved' }>
export interface CursorChannel {
  move(): void
  hide(): void
  close(): void
}

/** 只访问页面本身的 Hub；断线丢弃双方位置，重连不携带旧指针或事件序号。 */
export function openCursorChannel(
  artifactId: string,
  pageId: string,
  readPoint: () => { x: number; y: number } | undefined,
  receive: (event: Exclude<CanvasCursorEvent, { type: 'cursor.ready' }>) => void,
  disconnected: () => void,
): CursorChannel {
  const url = new URL('/api/v1/ws', window.location.origin)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  url.search = new URLSearchParams({ channel: 'canvas-presence', artifactId, pageId }).toString()
  let socket: WebSocket
  let ready = false
  let retryMs = 500
  let retry: number | undefined
  let frame: number | undefined
  const send = (input: CanvasCursorInput) => {
    if (ready && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(input))
  }
  const flush = () => {
    frame = undefined
    const point = readPoint()
    if (point) send({ v, type: 'cursor.move', ...point })
  }
  const connect = () => {
    socket = new WebSocket(url)
    socket.onmessage = ({ data }) => {
      if (typeof data !== 'string') return
      let raw: unknown
      try {
        raw = JSON.parse(data)
      } catch {
        return
      }
      const event = CanvasCursorEventSchema.safeParse(raw)
      if (!event.success) return
      if (event.data.type === 'cursor.ready') {
        ready = true
        retryMs = 500
        flush()
      } else if (ready) receive(event.data)
    }
    socket.onclose = ({ code }) => {
      ready = false
      window.clearTimeout(frame)
      frame = undefined
      disconnected()
      if (code === 4403) return
      retry = window.setTimeout(connect, retryMs)
      retryMs = Math.min(8000, retryMs * 2)
    }
  }
  connect()
  return {
    move() {
      if (ready && frame === undefined) frame = window.setTimeout(flush, 50)
    },
    hide() {
      window.clearTimeout(frame)
      frame = undefined
      send({ v, type: 'cursor.hide' })
    },
    close() {
      window.clearTimeout(frame)
      window.clearTimeout(retry)
      socket.onclose = null
      socket.onmessage = null
      socket.close()
    },
  }
}
