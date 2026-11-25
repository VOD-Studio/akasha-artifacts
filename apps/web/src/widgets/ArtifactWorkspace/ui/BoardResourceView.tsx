import { Button } from '@akasha/ui/button'
import {
  type MouseEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { type CanvasBoard, type LoadedCanvasBoard, loadCanvasBoard } from '@/entities/artifact'
import { getRequestErrorMessage, isResourceUnavailable } from '@/shared/api/error'
import { AkashaMark } from '@/shared/brand'
import { useMessages } from '@/shared/i18n'
import type { BoardResources } from '../model/board-resources'
import { navigationMessages } from '../navigation/board-navigation-messages'

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
  const { t } = useMessages(navigationMessages)
  const entry = useSyncExternalStore(resources.subscribe, () => board && resources.get(board.id))
  const loadedBoard = useMemo(() => {
    if (board?.source !== undefined) return board as LoadedCanvasBoard
    return board && entry?.type === 'ready' ? loadCanvasBoard(board, entry.data) : undefined
  }, [board, entry])
  const boardReadError =
    entry?.type === 'error' ? getRequestErrorMessage(entry.cause, t('无法读取画板')) : undefined
  return {
    loadedBoard,
    boardReadError,
    canRetryBoard: entry?.type === 'error' && !isResourceUnavailable(entry.cause),
  }
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
  const { t } = useMessages(navigationMessages)
  const thumbnail = useSyncExternalStore(resources.subscribe, () => resources.thumbnail(id))
  return thumbnail ? (
    <img
      className="pointer-events-none absolute inset-0 size-full object-fill"
      src={thumbnail}
      alt={t('画板缩略图：{title}', { title })}
    />
  ) : null
}

type BoardDetailProps = Required<Omit<BoardResourceViewProps, 'detailed'>>

function BoardDetail({ board, resources, showThumbnail, render }: BoardDetailProps) {
  const { t, dir } = useMessages(navigationMessages)
  const { loadedBoard, boardReadError, canRetryBoard } = useBoardResource(board, resources)
  const [rendered, setRendered] = useState(false)
  useEffect(() => {
    if (showThumbnail) return () => resources.previewClosed(board.id)
  }, [board.id, resources, showThumbnail])
  const rootRef = useRef<HTMLFieldSetElement>(null)
  const retry = (event: MouseEvent<HTMLButtonElement>) => {
    // 重试按钮会随错误状态卸载；只在焦点确实位于按钮上时移到同一画板。
    if (document.activeElement === event.currentTarget)
      rootRef.current?.focus({ preventScroll: true })
    resources.retry(board.id)
  }

  return (
    <fieldset
      ref={rootRef}
      tabIndex={-1}
      aria-label={t('画板内容：{title}', { title: board.title })}
      className="h-full w-full min-w-0"
    >
      {loadedBoard && (
        <>
          {render(loadedBoard, () => setRendered(true))}
          {showThumbnail && !rendered && (
            <BoardThumbnail title={board.title} id={board.id} resources={resources} />
          )}
        </>
      )}
      {!loadedBoard && boardReadError !== undefined && (
        <div
          dir={dir}
          role="alert"
          className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-sm text-ink"
        >
          <p>
            {boardReadError === t('无法读取画板')
              ? boardReadError
              : t('画板读取失败：{error}', { error: boardReadError })}
          </p>
          {canRetryBoard && (
            <Button size="sm" variant="outline" className="pointer-events-auto" onClick={retry}>
              {t('重试读取画板')}
            </Button>
          )}
        </div>
      )}
      {!loadedBoard && boardReadError === undefined && (
        <div
          dir={dir}
          role="status"
          aria-busy="true"
          className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm text-ink-muted"
        >
          {showThumbnail && (
            <BoardThumbnail title={board.title} id={board.id} resources={resources} />
          )}
          <AkashaMark size={24} loading className="relative text-ink" />
          <span className="relative">{t('正在读取画板…')}</span>
        </div>
      )}
    </fieldset>
  )
}
