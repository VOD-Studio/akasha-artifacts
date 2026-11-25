import {
  type AnnotationThread,
  type Feedback,
  isAnnotationKind,
  type ReviewRound,
} from '@akasha/protocol'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@akasha/ui/select'
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle } from '@akasha/ui/sheet'
import { useEffect, useRef, useState } from 'react'
import { selectionForVersion, useSelectionStore } from '@/entities/selection'
import { useWorkspaceStore } from '@/entities/workspace'
import { useMessages } from '@/shared/i18n'
import { panelMessages } from '../messages'
import { AnnotationComposer } from './AnnotationComposer'
import { InspectorFeedbackCard } from './InspectorFeedbackCard'
import { ReviewActionsBar } from './ReviewActionsBar'
import { RoundSubmitBar } from './RoundSubmitBar'

interface ArtifactReviewPanelProps {
  artifactId: string
  projectId: string
  /** 控制编辑和定位的快照；历史线程仍可展示，但不套用到当前元素。 */
  activeVersion: number
  activeRound: ReviewRound | null
  feedbacks: readonly Feedback[]
  /** 查看者可读线程；分享审阅者可批注但不能投递 Agent。 */
  canComment?: boolean
  /** 分享会话不提供把反馈投递给所有者本机 Agent 的入口。 */
  notifyAgent?: boolean
  /** 仅包含当前版本、当前页内有确定画板归属的线程。 */
  pageFeedbackIds?: ReadonlySet<string>
  /** 讨论记录以根批注 ID 为键。Agent 回执状态仍在 feedbacks 中。 */
  threads?: Readonly<Record<string, AnnotationThread>>
  onFocusThread?: (feedback: Feedback) => void
}

function InspectorContent({
  artifactId,
  projectId,
  activeVersion,
  activeRound,
  feedbacks,
  canComment = true,
  notifyAgent = true,
  pageFeedbackIds,
  threads,
  onFocusThread,
}: ArtifactReviewPanelProps) {
  const { t } = useMessages(panelMessages)
  const selectedElement = useSelectionStore((s) =>
    selectionForVersion(s, artifactId, activeVersion),
  )
  const focusedFeedbackId = useSelectionStore((s) => s.focusedFeedbackId)
  const setFocusedFeedbackId = useSelectionStore((s) => s.setFocusedFeedbackId)

  const [scope, setScope] = useState('all')
  const [resolution, setResolution] = useState('all')
  const focusedCard = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (focusedFeedbackId) focusedCard.current?.scrollIntoView?.({ block: 'nearest' })
  }, [focusedFeedbackId])

  const changeScope = (next: string) => {
    setFocusedFeedbackId(null)
    setScope(next)
  }

  const changeResolution = (next: string) => {
    setFocusedFeedbackId(null)
    setResolution(next)
  }

  const focusFeedback = (feedback: Feedback) => {
    setFocusedFeedbackId(feedback.id)
    onFocusThread?.(feedback)
  }

  const ordered = feedbacks
    .filter((fb) => {
      if (fb.id === focusedFeedbackId) return true
      if (scope === 'page' && !pageFeedbackIds?.has(fb.id)) return false
      if (resolution === 'all') return true
      return (
        isAnnotationKind(fb.kind) &&
        (threads?.[fb.id]?.resolution ? resolution === 'resolved' : resolution === 'open')
      )
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const draftingRound = notifyAgent && activeRound?.status === 'drafting' ? activeRound : null

  return (
    <>
      <SheetHeader>
        <SheetTitle>{t('批注与评审')}</SheetTitle>
      </SheetHeader>
      <SheetBody>
        <div className="space-y-3">
          {canComment ? (
            <AnnotationComposer
              artifactId={artifactId}
              projectId={projectId}
              version={activeVersion}
              activeDraftingRound={draftingRound}
              notifyAgent={notifyAgent}
              selectedElement={selectedElement}
            />
          ) : null}

          {(canComment && notifyAgent) || activeRound?.groups.length ? (
            <ReviewActionsBar
              artifactId={artifactId}
              projectId={projectId}
              version={activeVersion}
              activeRound={activeRound}
              readOnly={!canComment || !notifyAgent}
            />
          ) : null}

          <div className="space-y-2 pt-1">
            <div className="text-[11px] font-medium text-ink-muted">
              {t('反馈（{count}）', { count: ordered.length })}
            </div>
            <div className="flex flex-wrap gap-2">
              {pageFeedbackIds && (
                <Select value={scope} onValueChange={changeScope}>
                  <SelectTrigger aria-label={t('批注范围')} controlSize="sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t('全部页面')}</SelectItem>
                    <SelectItem value="page">{t('当前页面')}</SelectItem>
                  </SelectContent>
                </Select>
              )}
              <Select value={resolution} onValueChange={changeResolution}>
                <SelectTrigger aria-label={t('解决状态')} controlSize="sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('全部状态')}</SelectItem>
                  <SelectItem value="open">{t('未解决')}</SelectItem>
                  <SelectItem value="resolved">{t('已解决')}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {ordered.length === 0 && (
              <p className="py-2 text-xs text-ink-muted">
                {feedbacks.length ? t('没有符合条件的反馈') : t('暂无反馈')}
              </p>
            )}
            {ordered.map((feedback) => (
              <InspectorFeedbackCard
                key={feedback.id}
                artifactId={artifactId}
                activeVersion={activeVersion}
                feedback={feedback}
                thread={threads?.[feedback.id]}
                canComment={canComment}
                isFocused={feedback.id === focusedFeedbackId}
                focusedCard={focusedCard}
                onFocusFeedback={focusFeedback}
              />
            ))}
          </div>
        </div>
      </SheetBody>
      {canComment && notifyAgent && activeRound && (
        <RoundSubmitBar
          artifactId={artifactId}
          projectId={projectId}
          activeRound={activeRound}
          feedbacks={feedbacks}
        />
      )}
    </>
  )
}

/** 批注与评审的非模态抽屉；开合不改变画布尺寸，线程定位由工作区处理。 */
export function ArtifactReviewPanel(props: ArtifactReviewPanelProps) {
  const { dir } = useMessages(panelMessages)
  const open = useWorkspaceStore((s) => s.inspectorTab === 'review')
  const setTab = useWorkspaceStore((s) => s.setInspectorTab)

  return (
    <Sheet modal={false} open={open} onOpenChange={(next) => setTab(next ? 'review' : null)}>
      <SheetContent
        side={dir === 'rtl' ? 'left' : 'right'}
        id="artifact-inspector"
        size="sm"
        aria-describedby={undefined}
        className="top-16 bottom-14 overflow-hidden"
      >
        <InspectorContent {...props} />
      </SheetContent>
    </Sheet>
  )
}
