import type { MouseEvent, ReactNode } from 'react'
import type { CanvasBoard, CanvasBounds, CanvasPage } from '@/entities/artifact'
import { useMessages } from '@/shared/i18n'
import type { useBoardGesture } from '../hooks/useBoardGesture'
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
  gesture: ReturnType<typeof useBoardGesture>
  onFocusTitle: (id: string, title: HTMLButtonElement, bounds: CanvasBounds) => void
  onNavigate: (boardId: string) => void
  onSelectTitle: (id: string, event: MouseEvent<HTMLButtonElement>) => void
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
  gesture,
  onFocusTitle,
  onNavigate,
  onSelectTitle,
  actions,
  children,
}: CanvasBoardTileProps) {
  const { t, dir } = useMessages(canvasToolsMessages)
  return (
    <div
      className="artifact-canvas-board"
      data-selected={isSelected}
      style={{
        left: camera.x + bounds.x * camera.scale,
        top: camera.y + bounds.y * camera.scale,
        width: bounds.width * camera.scale,
        height: bounds.height * camera.scale,
      }}
    >
      <div dir={dir} className="artifact-canvas-board-header">
        {/* 标题、命中区与尺寸柄的指针边界由画布布局决定。 */}
        <button
          type="button"
          className="artifact-canvas-board-title"
          aria-pressed={isSelected}
          data-board-id={board.id}
          title={board.subtitle ?? board.title}
          data-movable={canDrag ? true : undefined}
          {...gesture.events}
          onPointerDown={(event) => {
            if (!canDrag || event.shiftKey) return
            gesture.begin(event, board.id, bounds, 'move')
          }}
          onFocus={(event) => onFocusTitle(board.id, event.currentTarget, bounds)}
          onKeyDown={(event) => {
            const { key } = event
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
        {actions}
      </div>
      {children}
      {primary && canDrag ? (
        <button
          type="button"
          className="artifact-canvas-board-resize"
          tabIndex={-1}
          aria-label={t('拖动调整尺寸：{title}', { title: board.title })}
          title={t('拖动调整尺寸；键盘请使用设置画板')}
          {...gesture.events}
          onPointerDown={(event) => gesture.begin(event, board.id, bounds, 'resize')}
        />
      ) : null}
    </div>
  )
}
