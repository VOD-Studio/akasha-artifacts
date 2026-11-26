import { Button } from '@akasha/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@akasha/ui/popover'
import { Check, ChevronDown, MessageCircle, ScanLine } from 'lucide-react'
import { useState } from 'react'
import { useSelectionStore } from '@/entities/selection'
import { useWorkspaceStore } from '@/entities/workspace'
import { useMessages } from '@/shared/i18n'
import { messages } from '../messages'

/**
 * 顶栏右侧工作区控制组：
 * - 检查器按钮切换属性/源码/参数抽屉；
 * - 批注主按钮控制画布上的批注图钉显隐，右侧下拉箭头展开「查看全部批注」与显隐选项。
 */
export function WorkspacePanelButtons({
  feedbackCount,
  hasActiveRound,
}: {
  feedbackCount: number
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
        <ScanLine size={15} />
      </Button>

      <div
        className={`inline-flex items-center rounded-lg border transition-colors ${
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
          {feedbackCount > 0 ? (
            <span
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
              className={`h-7 w-5 rounded-s-none rounded-e-lg border-s px-0 ${
                showComments
                  ? 'border-(--canvas-selection-border) text-(--canvas-selection-strong) hover:bg-(--canvas-selection-tint)'
                  : 'border-border/60 text-ink-muted hover:bg-transparent hover:text-ink'
              }`}
            >
              <ChevronDown size={12} className="disclosure-chevron" />
            </Button>
          </PopoverTrigger>
          <PopoverContent
            align="end"
            sideOffset={6}
            className="w-52 rounded-xl border border-ol bg-popover/96 p-1 shadow-(--shadow-float) backdrop-blur-lg"
            aria-label={t('更多批注选项')}
          >
            <div className="flex flex-col gap-0.5">
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
              <hr className="my-0.5 border-0 border-t border-border/70" />
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-full justify-between rounded-lg px-2.5 text-xs font-normal text-ink"
                onClick={() => {
                  toggleShowComments()
                  setMenuOpen(false)
                }}
              >
                <span>{t('显示画布批注')}</span>
                {showComments ? (
                  <Check size={13} className="text-(--canvas-selection-strong)" />
                ) : null}
              </Button>
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </>
  )
}
