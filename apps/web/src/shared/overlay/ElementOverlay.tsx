import type { ElementRect, ElementRef, Feedback } from '@akasha/protocol'
import { MessageSquare } from 'lucide-react'

export interface ElementOverlayProps {
  selected: ElementRef | null
  pins: readonly Feedback[]
  // 由沙盒根据当前视口实时重算的图钉坐标；滚动、缩放或侧栏回流后优先采用实时坐标
  livePinRects?: Record<string, ElementRect | null>
  focusedFeedbackId: string | null
  /** 画布外层已绘制视口级图层选框时隐藏画板内重复描边，保留定位 DOM 节点。 */
  hideSelectionBox?: boolean
  /** 画布缩放倍率；用于反向补偿图钉尺寸，使其在任意倍率下都清晰可点击。 */
  pinScale?: number
  onSelectPin?: (feedback: Feedback) => void
}

function formatLocatorLabel(ref: ElementRef): string {
  if (ref.blockId) return `#${ref.blockId}`
  if (ref.loc) return `@${ref.loc}`
  if (ref.selector) return ref.selector.slice(0, 32)
  return ref.textPreview?.slice(0, 24) ?? '元素'
}

function getPinTone(feedback: Feedback): string {
  if (feedback.status === 'resolved') return 'border-success bg-card text-success'
  if (feedback.draft) return 'border-dashed border-warning bg-card text-warning'
  return 'border-(--canvas-selection) bg-(--canvas-selection) text-(--canvas-selection-foreground)'
}

/**
 * 外壳的透明叠层：绘制选中框与批注图钉。
 *
 * @remarks 不向沙盒 iframe 注入任何外壳节点。
 */
export function ElementOverlay({
  selected,
  pins,
  livePinRects,
  focusedFeedbackId,
  hideSelectionBox = false,
  pinScale,
  onSelectPin,
}: ElementOverlayProps) {
  const pinnedPositions = pins.length > 1 ? new Map<string, number>() : null
  const counterScale =
    pinScale !== undefined && pinScale > 0 && Math.abs(pinScale - 1) > 0.001 ? 1 / pinScale : null
  return (
    <div
      data-testid="shell-element-overlay"
      className="pointer-events-none absolute inset-0 z-10 overflow-hidden"
    >
      {selected?.rect && selected.rect.width > 0 && selected.rect.height > 0 ? (
        <div
          data-testid="overlay-select-box"
          style={{
            transform: `translate3d(${selected.rect.x}px, ${selected.rect.y}px, 0)`,
            width: `${selected.rect.width}px`,
            height: `${selected.rect.height}px`,
          }}
          className={`absolute top-0 left-0 rounded-[2px] border-[1.5px] border-(--canvas-selection) bg-(--canvas-selection-tint-soft) shadow-[0_0_0_1px_var(--card)] ${
            hideSelectionBox ? 'opacity-0' : ''
          }`}
        >
          <span
            style={{ top: selected.rect.y < 24 ? '2px' : '-22px' }}
            className="absolute left-0 rounded bg-(--canvas-selection) px-1.5 py-0.5 font-mono text-[10px] font-medium leading-none text-(--canvas-selection-foreground) shadow"
          >
            {formatLocatorLabel(selected)}
          </span>
        </div>
      ) : null}

      {pins.map((fb, idx) => {
        const isBoardAnchor = Boolean(
          fb.element?.boardId && fb.element?.blockId === fb.element.boardId && !fb.element.selector,
        )
        const hasLive = livePinRects !== undefined && Object.hasOwn(livePinRects, fb.id)
        let rect: ElementRect | null | undefined = hasLive ? livePinRects[fb.id] : fb.element?.rect
        // 画板级批注在沙盒内没有对应 DOM 节点，回退到保存时的点击坐标或默认画板左上锚点。
        if (!rect && isBoardAnchor) {
          rect = fb.element?.rect ?? { x: 24, y: 24, width: 1, height: 1 }
        }
        if (!rect || (rect.width <= 0 && rect.height <= 0)) return null
        const isFocused = fb.id === focusedFeedbackId
        const isPointAnchor = rect.width <= 1 && rect.height <= 1
        const pinX = isPointAnchor ? Math.max(4, rect.x) : Math.max(4, rect.x + rect.width - 10)
        let pinY = isPointAnchor ? Math.max(4, rect.y) : Math.max(4, rect.y - 10)
        if (pinnedPositions) {
          const position = `${Math.round(pinX)}:${Math.round(pinY)}`
          const overlap = pinnedPositions.get(position) ?? 0
          pinnedPositions.set(position, overlap + 1)
          pinY += overlap * (counterScale ? 26 * counterScale : 26)
        }

        const transform = counterScale
          ? `translate3d(${pinX}px, ${pinY}px, 0) scale(${counterScale})`
          : `translate3d(${pinX}px, ${pinY}px, 0)`

        return (
          <button
            key={fb.id}
            type="button"
            data-testid={`annotation-pin-${fb.id}`}
            aria-label={`打开批注 ${idx + 1}：${fb.body}`}
            onClick={(event) => {
              event.stopPropagation()
              onSelectPin?.(fb)
            }}
            title={fb.body}
            style={{
              transform,
              transformOrigin: 'left top',
            }}
            className={`pointer-events-auto absolute top-0 left-0 inline-flex h-6 min-w-6 items-center justify-center gap-0.5 rounded-full rounded-bl-sm border px-1.5 text-[10px] font-semibold shadow-sm transition hover:scale-105 ${getPinTone(fb)} ${
              isFocused ? 'ring-2 ring-(--canvas-selection) ring-offset-1' : ''
            }`}
          >
            <MessageSquare size={10} />
            <span>{idx + 1}</span>
          </button>
        )
      })}
    </div>
  )
}
