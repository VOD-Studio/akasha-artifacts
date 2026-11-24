import { Button } from '@akasha/ui/button'
import { type ReactNode, useState, useSyncExternalStore } from 'react'
import { type CanvasBoard, type LoadedCanvasBoard, loadCanvasBoard } from '@/entities/artifact'
import type { BoardResources } from './board-resources'

/** 非活动画板只展示已从同一版画面提取的缩略图；未访问过的画板保持布局轮廓。 */
export function BoardResourceView({
  board,
  resources,
  detailed,
  render,
}: {
  board: CanvasBoard
  resources: BoardResources
  detailed: boolean
  render: (board: LoadedCanvasBoard, ready: () => void) => ReactNode
}) {
  return detailed ? (
    <BoardDetail board={board} resources={resources} render={render} />
  ) : (
    <BoardThumbnail title={board.title} id={board.id} resources={resources} />
  )
}

export function readLoadedBoard(
  board: CanvasBoard,
  resources: BoardResources,
): LoadedCanvasBoard | undefined {
  if (board.source !== undefined) return board as LoadedCanvasBoard
  const entry = resources.get(board.id)
  return entry?.type === 'ready' ? loadCanvasBoard(board, entry.data) : undefined
}

export function useLoadedBoard(board: CanvasBoard | undefined, resources: BoardResources) {
  const entry = useSyncExternalStore(resources.subscribe, () => board && resources.get(board.id))
  if (board?.source !== undefined) return board as LoadedCanvasBoard
  return board && entry?.type === 'ready' ? loadCanvasBoard(board, entry.data) : undefined
}

function BoardThumbnail({
  title,
  id,
  resources,
}: {
  title: string
  id: string
  resources: BoardResources
}) {
  const thumbnail = useSyncExternalStore(resources.subscribe, () => resources.thumbnail(id))
  return thumbnail ? (
    <img
      className="pointer-events-none absolute inset-0 size-full object-fill"
      src={thumbnail}
      alt={`画板缩略图：${title}`}
    />
  ) : null
}

function BoardDetail({
  board,
  resources,
  render,
}: {
  board: CanvasBoard
  resources: BoardResources
  render: (board: LoadedCanvasBoard, ready: () => void) => ReactNode
}) {
  const entry = useSyncExternalStore(resources.subscribe, () => resources.get(board.id))
  const [rendered, setRendered] = useState(false)
  if (entry?.type === 'ready') {
    return (
      <>
        {render(loadCanvasBoard(board, entry.data), () => setRendered(true))}
        {!rendered && <BoardThumbnail title={board.title} id={board.id} resources={resources} />}
      </>
    )
  }
  if (entry?.type === 'error') {
    return (
      <div
        role="alert"
        className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-sm text-ink"
      >
        <p>画板读取失败：{entry.message}</p>
        <Button
          size="sm"
          variant="outline"
          className="pointer-events-auto"
          onClick={() => resources.retry(board.id)}
        >
          重试读取画板
        </Button>
      </div>
    )
  }
  return (
    <div
      aria-busy="true"
      className="absolute inset-0 grid place-items-center text-sm text-ink-muted"
    >
      <BoardThumbnail title={board.title} id={board.id} resources={resources} />
      正在读取画板…
    </div>
  )
}
