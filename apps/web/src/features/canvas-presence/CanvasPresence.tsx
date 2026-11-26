import { type RefObject, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { type Messages, useMessages } from '@/shared/i18n'
import { type CursorChannel, type CursorPosition, openCursorChannel } from './cursor-channel'

const messages = {
  '访客 {id}': ['Gast {id}', 'الضيف {id}', 'Guest {id}'],
  '协作者光标：{name}': [
    'Cursor von {name}',
    'مؤشر المتعاون: {name}',
    'Collaborator cursor: {name}',
  ],
} as const satisfies Messages

interface CanvasPresenceProps {
  artifactId: string
  pageId: string
  viewportRef: RefObject<HTMLElement | null>
  /** 视口里的物理偏移与世界像素倍率，和文案方向无关。 */
  camera: { x: number; y: number; scale: number }
}

/** 旁听视口输入，只有光标层随其他人的移动更新，不改变相机、选区或指针捕获。 */
export function CanvasPresence({ artifactId, pageId, viewportRef, camera }: CanvasPresenceProps) {
  const { t, dir } = useMessages(messages)
  const [peers, setPeers] = useState(() => new Map<string, CursorPosition>())
  const channel = useRef<CursorChannel | null>(null)
  const pointer = useRef<{ x: number; y: number } | null>(null)
  const currentCamera = useRef(camera)
  useLayoutEffect(() => {
    currentCamera.current = camera
    if (pointer.current) channel.current?.move()
  }, [camera])
  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport || typeof WebSocket !== 'function') return
    const connection = openCursorChannel(
      artifactId,
      pageId,
      () => {
        if (!pointer.current) return
        const { x, y, scale } = currentCamera.current
        const rect = viewport.getBoundingClientRect()
        return {
          x: (pointer.current.x - rect.left - viewport.clientLeft - x) / scale,
          y: (pointer.current.y - rect.top - viewport.clientTop - y) / scale,
        }
      },
      (event) => {
        setPeers((current) => {
          const next = new Map(current)
          if (event.type === 'cursor.left') next.delete(event.peerId)
          else next.set(event.peerId, event)
          return next
        })
      },
      () => {
        pointer.current = null
        setPeers(new Map())
      },
    )
    channel.current = connection
    const move = (event: PointerEvent) => {
      pointer.current = { x: event.clientX, y: event.clientY }
      connection.move()
    }
    const hide = () => {
      if (!pointer.current) return
      pointer.current = null
      connection.hide()
    }
    const releaseTouch = (event: PointerEvent) => {
      if (event.pointerType === 'touch') hide()
    }
    const hidden = () => {
      if (document.hidden) hide()
    }
    const controller = new AbortController()
    const options = { capture: true, passive: true, signal: controller.signal }
    viewport.addEventListener('pointermove', move, options)
    viewport.addEventListener('pointerup', releaseTouch, options)
    viewport.addEventListener('pointerleave', hide, { signal: controller.signal })
    viewport.addEventListener('pointercancel', hide, options)
    window.addEventListener('blur', hide, { signal: controller.signal })
    document.addEventListener('visibilitychange', hidden, { signal: controller.signal })
    return () => {
      controller.abort()
      channel.current = null
      pointer.current = null
      connection.close()
    }
  }, [artifactId, pageId, viewportRef])

  return (
    <div className="pointer-events-none absolute inset-0 z-10 overflow-clip select-none print:hidden">
      {[...peers.values()].map((peer) => {
        const name = peer.login ? `@${peer.login}` : t('访客 {id}', { id: peer.peerId.slice(0, 4) })
        return (
          <span
            key={peer.peerId}
            role="img"
            aria-label={t('协作者光标：{name}', { name })}
            className="absolute flex flex-col items-start"
            style={{
              left: camera.x + peer.x * camera.scale,
              top: camera.y + peer.y * camera.scale,
            }}
          >
            <svg aria-hidden="true" width="16" height="18" viewBox="0 0 16 18">
              <path d="M1 1l13 8-6 1-3 6z" fill="black" stroke="white" strokeLinejoin="round" />
            </svg>
            <span
              dir={dir}
              className="ms-2 whitespace-nowrap rounded bg-ink px-1.5 py-0.5 text-xs text-surface shadow-xs"
            >
              {name}
            </span>
          </span>
        )
      })}
    </div>
  )
}
