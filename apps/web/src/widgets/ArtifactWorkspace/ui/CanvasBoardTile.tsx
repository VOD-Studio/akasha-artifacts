import type { CSSProperties, MouseEvent, PointerEvent, ReactNode } from 'react'
import type { CanvasBoard, CanvasBounds, CanvasPage } from '@/entities/artifact'
import { useMessages } from '@/shared/i18n'
import type { Camera } from '../lib/canvas-camera'
import { canvasToolsMessages } from '../toolbar/canvas-tools-messages'

interface CanvasBoardTileProps {
  board: CanvasBoard
  page: CanvasPage
  camera: Camera
  bounds: CanvasBounds
  isSelected: boolean
  primary: boolean
  canDrag: boolean
  onBeginGesture: (
    event: PointerEvent<HTMLButtonElement>,
    id: string,
    bounds: CanvasBounds,
    mode: 'move' | 'resize',
  ) => void
  onFocusTitle: (id: string, title: HTMLButtonElement, bounds: CanvasBounds) => void
  onNavigate: (boardId: string) => void
  onSelectTitle: (id: string, event: MouseEvent<HTMLButtonElement>) => void
  /** 在画板标题上按 Return 时进入该画板的顶层图层。 */
  onEnterBoard?: (boardId: string) => void
  /** 跨板边界的原生图层外部溢出展示，与画板裁切区平级。 */
  overflow?: ReactNode
  actions: ReactNode
  children: ReactNode
}

/** 用相机投影画板与控件；移动按组抓取初始边界，尺寸柄只作用于主选板。 */
export function CanvasBoardTile({
  board,
  page,
  camera,
  bounds,
  isSelected,
  primary,
  canDrag,
  onBeginGesture,
  onFocusTitle,
  onNavigate,
  onSelectTitle,
  onEnterBoard,
  overflow,
  actions,
  children,
}: CanvasBoardTileProps) {
  const { t, dir } = useMessages(canvasToolsMessages)
  const pixelWidth = bounds.width * camera.scale
  const pixelHeight = bounds.height * camera.scale
  const compactHeader = !isSelected && (pixelWidth < 110 || pixelHeight < 64)
  const hideActions = pixelWidth < 160 || pixelHeight < 72
  const headerScale = camera.scale >= 0.45 ? 1 : Math.max(0.72, Math.min(1, camera.scale / 0.45))
  const headerStyle = {
    '--board-header-scale': headerScale.toFixed(3),
  } as CSSProperties
  return (
    <div
      className="artifact-canvas-board"
      data-selected={isSelected}
      style={{
        left: camera.x + bounds.x * camera.scale,
        top: camera.y + bounds.y * camera.scale,
        width: pixelWidth,
        height: pixelHeight,
      }}
    >
      <div
        dir={dir}
        style={headerStyle}
        data-compact={compactHeader ? 'true' : undefined}
        data-hide-actions={hideActions ? 'true' : undefined}
        className="artifact-canvas-board-header"
      >
        {/* 标题、命中区与尺寸柄的指针边界由画布布局决定。 */}
        <button
          type="button"
          className="artifact-canvas-board-title"
          aria-pressed={isSelected}
          data-board-id={board.id}
          title={board.subtitle ?? board.title}
          data-movable={canDrag ? true : undefined}
          onPointerDown={(event) => {
            if (!canDrag || event.shiftKey) return
            onBeginGesture(event, board.id, bounds, 'move')
          }}
          onFocus={(event) => onFocusTitle(board.id, event.currentTarget, bounds)}
          onKeyDown={(event) => {
            const { key } = event
            if (
              key === 'Enter' &&
              !event.shiftKey &&
              !event.altKey &&
              !event.ctrlKey &&
              !event.metaKey &&
              !event.nativeEvent.isComposing &&
              onEnterBoard
            ) {
              event.preventDefault()
              onEnterBoard(board.id)
              return
            }
            if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(key))
              return
            event.preventDefault()
            const index = page.boards.indexOf(board)
            const offset = key === 'ArrowLeft' || key === 'ArrowUp' ? -1 : 1
            let next: CanvasBoard | undefined = page.boards[index + offset]
            if (key === 'Home') next = page.boards[0]
            if (key === 'End') next = page.boards.at(-1)
            if (next && next.id !== board.id) onNavigate(next.id)
          }}
          onClick={(event) => onSelectTitle(board.id, event)}
        >
          {board.title}
          {board.recommended ? (
            <span className="ms-2 text-[10px] opacity-75">{t('推荐')}</span>
          ) : null}
        </button>
        <div className="artifact-canvas-board-actions">{actions}</div>
      </div>
      {children}
      {overflow}
      {primary && canDrag ? (
        <button
          type="button"
          className="artifact-canvas-board-resize"
          tabIndex={-1}
          aria-label={t('拖动调整尺寸：{title}', { title: board.title })}
          title={t('拖动调整尺寸；键盘请使用设置画板')}
          onPointerDown={(event) => onBeginGesture(event, board.id, bounds, 'resize')}
        />
      ) : null}
    </div>
  )
}
