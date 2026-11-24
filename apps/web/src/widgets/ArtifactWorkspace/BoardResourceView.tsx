import { Button } from '@akasha/ui/button'
import { type ReactNode, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { type CanvasBoard, type LoadedCanvasBoard, loadCanvasBoard } from '@/entities/artifact'
import type { BoardResources } from './board-resources'

interface BoardResourceViewProps {
  board: CanvasBoard
  resources: BoardResources
  detailed: boolean
  /** 聚焦和试玩不显示总览缓存，即使新帧还未渲染。 */
  showThumbnail?: boolean
  render: (board: LoadedCanvasBoard, ready: () => void) => ReactNode
}

/** 非活动画板只展示已从同一版画面提取的缩略图；未访问过的画板保持布局轮廓。 */
export function BoardResourceView({
  board,
  resources,
  detailed,
  showThumbnail = true,
  render,
}: BoardResourceViewProps) {
  if (detailed) {
    return (
      <BoardDetail
        board={board}
        resources={resources}
        showThumbnail={showThumbnail}
        render={render}
      />
    )
  }
  if (!showThumbnail) return null
  return <BoardThumbnail title={board.title} id={board.id} resources={resources} />
}

export function readLoadedBoard(
  board: CanvasBoard,
  resources: BoardResources,
): LoadedCanvasBoard | undefined {
  if (board.source !== undefined) return board as LoadedCanvasBoard
  const entry = resources.get(board.id)
  return entry?.type === 'ready' ? loadCanvasBoard(board, entry.data) : undefined
}

export function useBoardResource(board: CanvasBoard | undefined, resources: BoardResources) {
  const entry = useSyncExternalStore(resources.subscribe, () => board && resources.get(board.id))
  const loadedBoard = useMemo(() => {
    if (board?.source !== undefined) return board as LoadedCanvasBoard
    return board && entry?.type === 'ready' ? loadCanvasBoard(board, entry.data) : undefined
  }, [board, entry])
  return { loadedBoard, boardReadError: entry?.type === 'error' ? entry.message : undefined }
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

type BoardDetailProps = Required<Omit<BoardResourceViewProps, 'detailed'>>

function BoardDetail({ board, resources, showThumbnail, render }: BoardDetailProps) {
  const { loadedBoard, boardReadError } = useBoardResource(board, resources)
  const [rendered, setRendered] = useState(false)
  useEffect(() => {
    if (showThumbnail) return () => resources.previewClosed(board.id)
  }, [board.id, resources, showThumbnail])
  if (loadedBoard) {
    return (
      <>
        {render(loadedBoard, () => setRendered(true))}
        {showThumbnail && !rendered && (
          <BoardThumbnail title={board.title} id={board.id} resources={resources} />
        )}
      </>
    )
  }
  if (boardReadError !== undefined) {
    return (
      <div
        role="alert"
        className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-sm text-ink"
      >
        <p>画板读取失败：{boardReadError}</p>
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
      {showThumbnail && <BoardThumbnail title={board.title} id={board.id} resources={resources} />}
      正在读取画板…
    </div>
  )
}
