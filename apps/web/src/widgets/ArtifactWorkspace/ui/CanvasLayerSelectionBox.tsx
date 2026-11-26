import type { DesignLayer } from '@akasha/protocol'
import type { KeyboardEvent, MouseEvent, PointerEvent, RefObject } from 'react'
import type { CanvasBounds } from '@/entities/artifact'
import { useMessages } from '@/shared/i18n'
import type { LayerGestureMode, LayerResizeHandle } from '../hooks/useLayerGesture'
import { canvasToolsMessages } from '../toolbar/canvas-tools-messages'

const HANDLES: ReadonlyArray<{
  id: LayerResizeHandle
  xRatio: 0 | 0.5 | 1
  yRatio: 0 | 0.5 | 1
  cursor: string
  corner: boolean
}> = [
  { id: 'nw', xRatio: 0, yRatio: 0, cursor: 'nwse-resize', corner: true },
  { id: 'n', xRatio: 0.5, yRatio: 0, cursor: 'ns-resize', corner: false },
  { id: 'ne', xRatio: 1, yRatio: 0, cursor: 'nesw-resize', corner: true },
  { id: 'e', xRatio: 1, yRatio: 0.5, cursor: 'ew-resize', corner: false },
  { id: 'se', xRatio: 1, yRatio: 1, cursor: 'nwse-resize', corner: true },
  { id: 's', xRatio: 0.5, yRatio: 1, cursor: 'ns-resize', corner: false },
  { id: 'sw', xRatio: 0, yRatio: 1, cursor: 'nesw-resize', corner: true },
  { id: 'w', xRatio: 0, yRatio: 0.5, cursor: 'ew-resize', corner: false },
]

export interface CanvasLayerSelectionBoxProps {
  focusRef: RefObject<HTMLButtonElement | null>
  /** 选区在画布视口坐标系中的屏幕包围盒。 */
  rect: CanvasBounds
  /** 仅拖拽/缩放预览时展示实时固有坐标尺寸徽标。 */
  previewBounds?: CanvasBounds | null
  label: string
  /** 仅可编辑的原生图层在选择模式下开放直接拖拽与缩放手柄。 */
  canTransform: boolean
  transforming: boolean
  designLayer?: DesignLayer
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void
  onBeginGesture: (event: PointerEvent<HTMLElement>, mode: LayerGestureMode) => boolean
  gestureEvents: {
    onPointerMove: (event: PointerEvent<HTMLElement>) => void
    onPointerUp: (event: PointerEvent<HTMLElement>) => void
    onPointerCancel: (event: PointerEvent<HTMLElement>) => void
    onLostPointerCapture: (event: PointerEvent<HTMLElement>) => void
  }
  onDoubleClickText?: (event: MouseEvent<HTMLButtonElement>) => void
  /** 按住 Cmd/Ctrl 点击已选大容器内部时透传穿透选子元素。 */
  onDeepClick?: (event: MouseEvent<HTMLButtonElement>) => void
}

/**
 * 画布图层统一选区框：承接键盘层级导航焦点；原生图层与静态 HTML 元素额外提供直接拖移、八向缩放手柄与双击原地编辑。
 */
export function CanvasLayerSelectionBox({
  focusRef,
  rect,
  previewBounds,
  label,
  canTransform,
  transforming,
  designLayer: _designLayer,
  onKeyDown,
  onBeginGesture,
  gestureEvents,
  onDoubleClickText,
  onDeepClick,
}: CanvasLayerSelectionBoxProps) {
  const { t } = useMessages(canvasToolsMessages)
  const showEdgeHandles = rect.width >= 32 && rect.height >= 32

  return (
    <>
      <button
        ref={focusRef}
        type="button"
        data-testid="canvas-layer-focus"
        data-movable={canTransform ? 'true' : undefined}
        data-transforming={transforming ? 'true' : undefined}
        className="artifact-canvas-layer-focus"
        aria-label={t(
          '当前图层：{label}（Tab 遍历，Return 进入，Shift+Return 退一层，F6 选区工具栏，Esc 回板）',
          { label: label || t('画布') },
        )}
        style={{
          left: rect.x,
          top: rect.y,
          width: rect.width,
          height: rect.height,
        }}
        onKeyDown={onKeyDown}
        onPointerDown={
          canTransform
            ? (event) => {
                if (event.pointerType === 'touch') return
                if (event.metaKey || event.ctrlKey) return
                onBeginGesture(event, 'move')
              }
            : undefined
        }
        onPointerMove={canTransform ? gestureEvents.onPointerMove : undefined}
        onPointerUp={canTransform ? gestureEvents.onPointerUp : undefined}
        onPointerCancel={canTransform ? gestureEvents.onPointerCancel : undefined}
        onLostPointerCapture={canTransform ? gestureEvents.onLostPointerCapture : undefined}
        onClick={
          canTransform
            ? (event) => {
                event.stopPropagation()
                if ((event.metaKey || event.ctrlKey) && onDeepClick) {
                  onDeepClick(event)
                }
              }
            : undefined
        }
        onDoubleClick={
          canTransform && onDoubleClickText
            ? (event) => {
                event.stopPropagation()
                onDoubleClickText(event)
              }
            : undefined
        }
      >
        {previewBounds ? (
          <span
            dir="ltr"
            data-testid="canvas-layer-dimensions"
            className="pointer-events-none absolute left-1/2 top-[calc(100%+6px)] -translate-x-1/2 whitespace-nowrap rounded bg-(--canvas-selection) px-1.5 py-0.5 font-mono text-[10px] leading-none text-(--canvas-selection-foreground) shadow-xs tabular-nums"
          >
            {previewBounds.width} × {previewBounds.height}
          </span>
        ) : null}
      </button>
      {canTransform
        ? HANDLES.filter((handle) => handle.corner || showEdgeHandles).map((handle) => (
            <button
              key={handle.id}
              type="button"
              tabIndex={-1}
              data-testid={`canvas-layer-handle-${handle.id}`}
              aria-label={t('调整尺寸：{handle}', { handle: handle.id })}
              className="artifact-canvas-layer-handle"
              style={{
                left: rect.x + rect.width * handle.xRatio,
                top: rect.y + rect.height * handle.yRatio,
                cursor: handle.cursor,
              }}
              onPointerDown={(event) => {
                if (event.pointerType === 'touch') return
                onBeginGesture(event, handle.id)
              }}
              onPointerMove={gestureEvents.onPointerMove}
              onPointerUp={gestureEvents.onPointerUp}
              onPointerCancel={gestureEvents.onPointerCancel}
              onLostPointerCapture={gestureEvents.onLostPointerCapture}
              onClick={(event) => event.stopPropagation()}
            />
          ))
        : null}
    </>
  )
}
