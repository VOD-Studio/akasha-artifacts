import { Button } from '@akasha/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@akasha/ui/popover'
import { ChevronDown, MessageCircle, PanelRight } from 'lucide-react'
import { useState } from 'react'
import { useSelectionStore } from '@/entities/selection'
import { useWorkspaceStore } from '@/entities/workspace'
import { useMessages } from '@/shared/i18n'
import { messages } from '../messages'

/**
 * 顶栏右侧工作区控制组：
 * - 检查器按钮切换属性/源码/参数抽屉；
 * - 批注主按钮控制画布上的批注图钉显隐，有未解决批注时在图标右上角展示提示点；
 * - 右侧下拉箭头打开「查看全部批注」快捷入口。
 */
export function WorkspacePanelButtons({
  feedbackCount,
  unresolvedCount,
  hasActiveRound,
}: {
  feedbackCount: number
  unresolvedCount?: number
  hasActiveRound: boolean
}) {
  const { t, number } = useMessages(messages)
  const panel = useWorkspaceStore((state) => state.inspectorTab)
  const setPanel = useWorkspaceStore((state) => state.setInspectorTab)
  const showComments = useWorkspaceStore((state) => state.showComments)
  const toggleShowComments = useWorkspaceStore((state) => state.toggleShowComments)
  const [menuOpen, setMenuOpen] = useState(false)
  const inspectOpen = panel === 'inspect'
  const reviewOpen = panel === 'review'
  const hasUnreadIndicator = (unresolvedCount ?? feedbackCount) > 0

  const toggleInspect = () => setPanel(inspectOpen ? null : 'inspect')
  const toggleReview = () => {
    useSelectionStore.getState().setFocusedFeedbackId(null)
    setPanel(reviewOpen ? null : 'review')
    setMenuOpen(false)
  }

  const toggleVisibilityLabel = t(showComments ? '隐藏画布批注' : '显示画布批注')

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        iconOnly
        aria-label={t('检查器')}
        title={t('检查器')}
        aria-expanded={inspectOpen}
        aria-haspopup="dialog"
        aria-controls={inspectOpen ? 'design-inspector' : undefined}
        className={
          inspectOpen
            ? 'bg-(--canvas-selection-tint) text-(--canvas-selection-strong) hover:bg-(--canvas-selection-tint)'
            : undefined
        }
        onClick={toggleInspect}
      >
        <PanelRight size={15} className="rtl:-scale-x-100" />
      </Button>

      <div
        className={`group inline-flex items-center rounded-lg border transition-colors ${
          showComments
            ? 'border-(--canvas-selection-border) bg-(--canvas-selection-tint)'
            : 'border-transparent hover:bg-surface-subtle'
        }`}
      >
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          aria-label={toggleVisibilityLabel}
          title={toggleVisibilityLabel}
          aria-pressed={showComments}
          className={`relative h-7 w-7 rounded-e-none rounded-s-lg ${
            showComments
              ? 'text-(--canvas-selection-strong) hover:bg-(--canvas-selection-tint)'
              : 'text-ink-muted hover:bg-transparent hover:text-ink'
          }`}
          onClick={toggleShowComments}
        >
          <MessageCircle size={15} className={showComments ? 'fill-current/15' : undefined} />
          {hasUnreadIndicator ? (
            <span
              data-testid="comments-unread-dot"
              aria-hidden="true"
              className="absolute top-1 end-1 size-1.5 rounded-full bg-(--canvas-selection) ring-2 ring-surface"
            />
          ) : null}
        </Button>

        <Popover open={menuOpen} onOpenChange={setMenuOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              iconOnly
              aria-label={t('更多批注选项')}
              title={t('更多批注选项')}
              aria-expanded={menuOpen}
              aria-haspopup="dialog"
              className={`h-7 w-5 rounded-s-none rounded-e-lg px-0 ${
                showComments
                  ? 'border-s border-(--canvas-selection-border) text-(--canvas-selection-strong) hover:bg-(--canvas-selection-tint)'
                  : 'border-s border-transparent text-ink-muted group-hover:border-border/60 hover:bg-transparent hover:text-ink'
              }`}
            >
              <ChevronDown size={12} className="disclosure-chevron" />
            </Button>
          </PopoverTrigger>
          <PopoverContent
            align="end"
            sideOffset={6}
            className="w-48 rounded-xl border border-ol bg-popover/96 p-1 shadow-(--shadow-float) backdrop-blur-lg"
            aria-label={t('更多批注选项')}
          >
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-full justify-between rounded-lg px-2.5 text-xs font-normal text-ink"
              onClick={toggleReview}
            >
              <span>{hasActiveRound ? t('查看评审面板') : t('查看全部批注')}</span>
              <span className="font-mono text-xs text-ink-muted tabular-nums">
                {number(feedbackCount)}
              </span>
            </Button>
          </PopoverContent>
        </Popover>
      </div>
    </>
  )
}
