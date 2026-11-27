import { Button } from '@akasha/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@akasha/ui/dropdown-menu'
import { ListHighlightItem } from '@akasha/ui/list-highlight'
import { Maximize2, Pause, Play } from 'lucide-react'
import { Fragment, useRef } from 'react'
import type { CanvasBoard } from '@/entities/artifact'
import { useMessages } from '@/shared/i18n'
import { navigationMessages } from './board-navigation-messages'

interface CanvasPlaybackMenuProps {
  boards: readonly CanvasBoard[]
  canPlay: (board: CanvasBoard) => boolean
  canAnimate: (board: CanvasBoard) => boolean
  paused: boolean
  onTogglePause: () => void
  /** 传入菜单触发器而非将卸载的菜单项，供离开展示时恢复焦点。 */
  onOpen: (boardId: string, trigger: HTMLButtonElement) => void
  onPlay: (boardId: string, trigger: HTMLButtonElement) => void
}

const GROUPS = [
  { key: 'static', label: '静态画板', action: '展开画板：{title}', Icon: Maximize2 },
  { key: 'animation', label: '动画画板', action: '展开画板：{title}', Icon: Maximize2 },
  { key: 'prototype', label: '可交互原型', action: '播放原型：{title}', Icon: Play },
] as const

type PlaybackGroup = (typeof GROUPS)[number]['key']

interface PlaybackMenuItemsProps extends Omit<CanvasPlaybackMenuProps, 'onOpen' | 'onPlay'> {
  onSelectBoard: (boardId: string, group: PlaybackGroup) => void
}

/** 菜单只在打开时遍历整页画板，画布平移缩放不需要重建隐藏菜单。 */
function PlaybackMenuItems({
  boards,
  canPlay,
  canAnimate,
  paused,
  onTogglePause,
  onSelectBoard,
}: PlaybackMenuItemsProps) {
  const { t } = useMessages(navigationMessages)
  const groups: Record<PlaybackGroup, CanvasBoard[]> = { static: [], animation: [], prototype: [] }
  let hasAnimation = false
  for (const board of boards) {
    const animated = canAnimate(board)
    hasAnimation ||= animated
    let group: PlaybackGroup = 'static'
    if (canPlay(board)) group = 'prototype'
    else if (animated) group = 'animation'
    groups[group].push(board)
  }

  return (
    <>
      {hasAnimation && (
        <DropdownMenuItem onSelect={onTogglePause}>
          {paused ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />}
          {t(paused ? '恢复画板动画' : '暂停画板动画')}
        </DropdownMenuItem>
      )}
      {GROUPS.filter(({ key }) => groups[key].length > 0).map(
        ({ key, label, action, Icon }, index) => (
          <Fragment key={key}>
            {(hasAnimation || index > 0) && <DropdownMenuSeparator />}
            <DropdownMenuGroup aria-label={t(label)}>
              <DropdownMenuLabel aria-hidden="true">{t(label)}</DropdownMenuLabel>
              {groups[key].map((board) => (
                <DropdownMenuItem
                  key={board.id}
                  aria-label={t(action, { title: board.title })}
                  title={board.title}
                  onSelect={() => onSelectBoard(board.id, key)}
                >
                  <Icon aria-hidden="true" />
                  <span dir="auto" className="min-w-0 truncate">
                    {board.title}
                  </span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </Fragment>
        ),
      )}
    </>
  )
}

/** 当前页的画板可从菜单直达，不改变总览中的选中画板。 */
export function CanvasPlaybackMenu({ onOpen, onPlay, ...options }: CanvasPlaybackMenuProps) {
  const { t, dir } = useMessages(navigationMessages)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const enteringPresentation = useRef(false)

  const selectBoard = (boardId: string, group: PlaybackGroup) => {
    const trigger = triggerRef.current
    if (!trigger) return
    enteringPresentation.current = true
    const action = group === 'prototype' ? onPlay : onOpen
    action(boardId, trigger)
  }
  const restoreFocus = (event: Event) => {
    if (!enteringPresentation.current) return
    // 单板查看或原型接管焦点；退出时外壳再恢复到触发器。
    event.preventDefault()
    enteringPresentation.current = false
  }

  return (
    <DropdownMenu dir={dir} modal={false}>
      <DropdownMenuTrigger asChild>
        <ListHighlightItem>
          <Button ref={triggerRef} variant="ghost" size="sm" leftIcon={<Play size={14} />}>
            {t('播放')}
          </Button>
        </ListHighlightItem>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" onCloseAutoFocus={restoreFocus}>
        <PlaybackMenuItems {...options} onSelectBoard={selectBoard} />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
