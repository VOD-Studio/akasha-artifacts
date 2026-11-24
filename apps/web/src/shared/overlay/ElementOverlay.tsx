import type { ElementRect, ElementRef, Feedback } from '@akasha/protocol'
import { MessageSquare } from 'lucide-react'

export interface ElementOverlayProps {
  hovered: ElementRef | null
  selected: ElementRef | null
  pins: readonly Feedback[]
  // 由沙盒根据当前视口实时重算的图钉坐标；滚动、缩放或侧栏回流后优先采用实时坐标
  livePinRects?: Record<string, ElementRect | null>
  focusedFeedbackId: string | null
  onSelectPin?: (feedback: Feedback) => void
}

function formatLocatorLabel(ref: ElementRef): string {
  if (ref.blockId) return `#${ref.blockId}`
  if (ref.loc) return `@${ref.loc}`
  if (ref.selector) return ref.selector.slice(0, 32)
  return ref.textPreview?.slice(0, 24) ?? 'element'
}

/**
 * 外壳的透明叠层：在主窗口的 DOM 里绘制悬停框、选中框与批注图钉。
 *
 * @remarks 不向沙盒 iframe 注入任何外壳节点。
 */
export function ElementOverlay({
  hovered,
  selected,
  pins,
  livePinRects,
  focusedFeedbackId,
  onSelectPin,
}: ElementOverlayProps) {
  const pinnedPositions = pins.length > 1 ? new Map<string, number>() : null
  return (
    <div
      data-testid="shell-element-overlay"
      className="pointer-events-none absolute inset-0 z-10 overflow-hidden"
    >
      {hovered?.rect && hovered.rect.width > 0 && hovered.rect.height > 0 ? (
        <div
          data-testid="overlay-hover-box"
          style={{
            transform: `translate3d(${hovered.rect.x}px, ${hovered.rect.y}px, 0)`,
            width: `${hovered.rect.width}px`,
            height: `${hovered.rect.height}px`,
          }}
          className="absolute top-0 left-0 rounded border border-dashed border-primary shadow-[0_0_0_1px_var(--card)] transition-[transform,width,height] duration-75"
        >
          <span
            style={{ top: hovered.rect.y < 24 ? '2px' : '-22px' }}
            className="absolute left-0 rounded bg-primary px-1.5 py-0.5 font-mono text-[10px] leading-none text-primary-foreground shadow-sm"
          >
            {formatLocatorLabel(hovered)}
          </span>
        </div>
      ) : null}

      {selected?.rect && selected.rect.width > 0 && selected.rect.height > 0 ? (
        <div
          data-testid="overlay-select-box"
          style={{
            transform: `translate3d(${selected.rect.x}px, ${selected.rect.y}px, 0)`,
            width: `${selected.rect.width}px`,
            height: `${selected.rect.height}px`,
          }}
          className="absolute top-0 left-0 rounded border-2 border-primary bg-foreground/10 shadow-[0_0_0_1px_var(--card)]"
        >
          <span
            style={{ top: selected.rect.y < 24 ? '2px' : '-22px' }}
            className="absolute left-0 rounded bg-primary px-1.5 py-0.5 font-mono text-[10px] font-medium leading-none text-primary-foreground shadow"
          >
            已选中 · {formatLocatorLabel(selected)}
          </span>
        </div>
      ) : null}

      {pins.map((fb, idx) => {
        const hasLive = livePinRects !== undefined && Object.hasOwn(livePinRects, fb.id)
        const rect = hasLive ? livePinRects[fb.id] : fb.element?.rect
        if (!rect || (rect.width <= 0 && rect.height <= 0)) return null
        const isFocused = fb.id === focusedFeedbackId
        const pinX = Math.max(4, rect.x + rect.width - 10)
        let pinY = Math.max(4, rect.y - 10)
        if (pinnedPositions) {
          const position = `${pinX}:${pinY}`
          const overlap = pinnedPositions.get(position) ?? 0
          pinnedPositions.set(position, overlap + 1)
          pinY += overlap * 26
        }
        const toneCls =
          fb.status === 'resolved'
            ? 'border-emerald-600 bg-emerald-50 text-emerald-700'
            : fb.draft
              ? 'border-dashed border-amber-500 bg-amber-50 text-amber-800'
              : 'border-primary bg-primary text-primary-foreground'

        return (
          <button
            key={fb.id}
            type="button"
            data-testid={`annotation-pin-${fb.id}`}
            aria-label={`打开批注 ${idx + 1}：${fb.body}`}
            onClick={() => onSelectPin?.(fb)}
            title={fb.body}
            style={{
              transform: `translate3d(${pinX}px, ${pinY}px, 0)`,
            }}
            className={`pointer-events-auto absolute top-0 left-0 inline-flex h-6 min-w-6 items-center justify-center gap-0.5 rounded-full border px-1.5 text-[10px] font-semibold shadow-sm transition hover:scale-105 ${toneCls} ${
              isFocused ? 'ring-2 ring-ring ring-offset-1' : ''
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
