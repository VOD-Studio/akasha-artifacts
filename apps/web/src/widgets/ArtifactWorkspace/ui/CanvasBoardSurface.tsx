import type { MouseEvent, ReactNode, RefObject } from 'react'
import type { CanvasBoard } from '@/entities/artifact'
import { useMessages } from '@/shared/i18n'
import type { CanvasBoardEditing } from '../hooks/useCanvasBoardEditing'
import type { CanvasTextTools } from '../hooks/useInlineCanvasText'
import type { Point } from '../lib/canvas-camera'
import { canvasToolsMessages } from '../toolbar/canvas-tools-messages'
import { BoardDrawingSurface, type DrawingTool } from './BoardDrawingSurface'
import { BoardLayoutGuides } from './BoardLayoutGuides'

/** 输入覆盖层互斥；只有绘制模式持有提交图层所需的版本和编辑权限。 */
export type CanvasBoardInput =
  | 'gesture'
  | 'interactive'
  | 'select'
  | { tool: DrawingTool; editing: CanvasBoardEditing }

interface CanvasBoardSurfaceProps {
  board: CanvasBoard
  scale: number
  showGuides: boolean
  input: CanvasBoardInput
  textTools?: CanvasTextTools
  wasPinching: RefObject<boolean>
  onClearElement: () => void
  selectBoard: (id: string, additive?: boolean) => void
  onSelectPoint?: (boardId: string, point: Point) => void
  onDrawingEnd: () => void
  children: ReactNode
}

/** 命中和双击按画板固有坐标定位；抓手、绘制和交互预览各自独占输入。 */
export function CanvasBoardSurface({
  board,
  scale,
  showGuides,
  input,
  textTools,
  wasPinching,
  onClearElement,
  selectBoard,
  onSelectPoint,
  onDrawingEnd,
  children,
}: CanvasBoardSurfaceProps) {
  const { t } = useMessages(canvasToolsMessages)
  const activateContent = (event: MouseEvent<HTMLButtonElement>) => {
    if (wasPinching.current && event.detail !== 0) return
    if (event.detail === 2) return
    onClearElement()
    selectBoard(board.id, event.shiftKey)
    if (event.detail !== 1 || event.shiftKey || !onSelectPoint) return
    const point = pointInBoard(board, event)
    if (point) onSelectPoint(board.id, point)
  }
  const editText = (event: MouseEvent<HTMLButtonElement>) => {
    if (!textTools || wasPinching.current || (board.type !== 'html' && board.type !== 'react'))
      return
    const point = pointInBoard(board, event)
    if (!point) return
    event.preventDefault()
    selectBoard(board.id)
    textTools.pick(board, point, { x: event.clientX, y: event.clientY })
  }
  return (
    <div
      className="artifact-canvas-board-clip"
      style={board.cornerRadius ? { borderRadius: board.cornerRadius * scale } : undefined}
    >
      <div
        style={{
          width: board.width,
          height: board.height,
          transform: `scale(${scale})`,
        }}
        className="artifact-canvas-board-frame"
      >
        {children}
        {board.layoutGuides?.length && showGuides ? (
          <BoardLayoutGuides
            width={board.width}
            height={board.height}
            guides={board.layoutGuides}
          />
        ) : null}
      </div>
      {/* 抓手与组合键缩放由外层捕获，不依赖跨域 iframe 冒泡。 */}
      {input === 'gesture' && (
        <div aria-hidden="true" data-gesture className="artifact-canvas-board-hit" />
      )}
      {typeof input === 'object' && (
        <BoardDrawingSurface
          key={input.tool.kind}
          board={board}
          tool={input.tool}
          version={input.editing.version}
          onCreate={(layer, base, anchor) => {
            selectBoard(board.id)
            onDrawingEnd()
            if (layer.kind === 'text' || layer.kind === 'note') {
              textTools?.place(board, layer, base, anchor)
            } else {
              input.editing.change({ kind: 'layerCreate', boardId: board.id, layer }, base)
            }
          }}
        />
      )}
      {input === 'select' && (
        <button
          type="button"
          tabIndex={-1}
          aria-label={t('选择画板：{title}', { title: board.title })}
          className="artifact-canvas-board-hit"
          onClick={activateContent}
          onDoubleClick={editText}
        />
      )}
    </div>
  )
}

function pointInBoard(board: CanvasBoard, event: MouseEvent<HTMLButtonElement>): Point | null {
  const rect = event.currentTarget.getBoundingClientRect()
  if (!rect.width || !rect.height) return null
  return {
    x: Math.max(0, ((event.clientX - rect.left) * board.width) / rect.width),
    y: Math.max(0, ((event.clientY - rect.top) * board.height) / rect.height),
  }
}
