import {
  type AnnotationThread,
  type Feedback,
  isAnnotationKind,
  type ReviewRound,
} from '@akasha/protocol'
import { Badge } from '@akasha/ui/badge'
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle } from '@akasha/ui/sheet'
import { Target } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { selectionForVersion, useSelectionStore } from '../../entities/selection/store'
import { useWorkspaceStore } from '../../entities/workspace/store'
import { AnnotationComposer } from '../../features/annotations/AnnotationComposer'
import { AnnotationThreadActions } from '../../features/annotations/AnnotationThreadActions'
import { ReviewActionsBar } from '../../features/review-actions/ReviewActionsBar'
import { formatRelativeTime } from '../../shared/lib/format'
import { RoundSubmitBar } from '../RoundSubmitBar/RoundSubmitBar'

export interface InspectorPanelProps {
  artifactId: string
  projectId: string
  activeVersion: number
  activeRound: ReviewRound | null
  feedbacks: readonly Feedback[]
  /** 查看者可读线程；分享审阅者可批注但不能投递 Agent。 */
  canComment?: boolean
  notifyAgent?: boolean
  /** 仅包含当前版本、当前页内有确定画板归属的线程。 */
  pageFeedbackIds?: ReadonlySet<string>
  /** 讨论记录以根批注 ID 为键。Agent 回执状态仍在 feedbacks 中。 */
  threads?: Readonly<Record<string, AnnotationThread>>
  onFocusThread?: (feedback: Feedback) => void
}

function feedbackStatusBadge(fb: Feedback): {
  label: string
  tone: 'warning' | 'accent' | 'ok' | 'neutral'
} {
  if (fb.draft) return { label: '草稿', tone: 'warning' }
  if (fb.audience === 'human') return { label: '仅讨论', tone: 'neutral' }
  if (fb.status === 'resolved')
    return { label: isAnnotationKind(fb.kind) ? 'Agent 已处理' : '已解决', tone: 'ok' }
  if (fb.status === 'delivered') return { label: '已送达', tone: 'accent' }
  return { label: '待处理', tone: 'neutral' }
}

function feedbackKindLabel(kind: Feedback['kind']): string {
  switch (kind) {
    case 'approve':
      return '批准'
    case 'request_changes':
      return '请求修改'
    case 'runtime_error':
      return '运行异常'
    case 'vote':
      return '方案选择'
    case 'pass':
      return 'Pass'
    case 'reject':
      return 'Reject'
    case 'waive':
      return 'Waive'
    case 'edit':
      return '直接修改'
    default:
      return '批注'
  }
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
}: InspectorPanelProps) {
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

  return (
    <>
      <SheetHeader>
        <SheetTitle>批注与评审</SheetTitle>
      </SheetHeader>
      <SheetBody>
        <div className="space-y-3">
          {canComment ? (
            <AnnotationComposer
              artifactId={artifactId}
              projectId={projectId}
              version={activeVersion}
              activeDraftingRound={activeRound?.status === 'drafting' ? activeRound : null}
              notifyAgent={notifyAgent}
              selectedElement={selectedElement}
            />
          ) : null}

          {notifyAgent ? (
            <ReviewActionsBar
              artifactId={artifactId}
              projectId={projectId}
              version={activeVersion}
              activeRound={activeRound}
            />
          ) : null}

          <div className="space-y-2 pt-1">
            <div className="text-[11px] font-medium text-ink-muted">
              反馈记录（{ordered.length}）
            </div>
            <div className="flex flex-wrap gap-2">
              {pageFeedbackIds ? (
                <select
                  aria-label="批注范围"
                  value={scope}
                  onChange={(event) => {
                    setFocusedFeedbackId(null)
                    setScope(event.target.value)
                  }}
                  className="rounded-md border border-border bg-surface px-2 py-1 text-xs"
                >
                  <option value="all">全部页面</option>
                  <option value="page">当前页</option>
                </select>
              ) : null}
              <select
                aria-label="解决状态"
                value={resolution}
                onChange={(event) => {
                  setFocusedFeedbackId(null)
                  setResolution(event.target.value)
                }}
                className="rounded-md border border-border bg-surface px-2 py-1 text-xs"
              >
                <option value="all">全部状态</option>
                <option value="open">未解决</option>
                <option value="resolved">已解决</option>
              </select>
            </div>

            {ordered.length === 0 ? (
              <p className="py-2 text-xs text-ink-muted">没有符合条件的批注与反馈。</p>
            ) : (
              ordered.map((fb) => {
                const statusMeta = feedbackStatusBadge(fb)
                const thread = threads?.[fb.id]
                const isOldVersion = fb.version !== activeVersion
                const isFocused = fb.id === focusedFeedbackId
                const points = fb.element?.dataPoints
                const locator = points
                  ? `${points.chartTitle} · ${points.points.length} 个数据点`
                  : fb.element?.textPreview ||
                    (fb.element?.blockId
                      ? `#${fb.element.blockId}`
                      : fb.element?.loc
                        ? `@${fb.element.loc}`
                        : fb.element?.selector?.slice(0, 28))

                return (
                  <div
                    key={fb.id}
                    ref={isFocused ? focusedCard : undefined}
                    aria-current={isFocused || undefined}
                    data-testid={`feedback-item-${fb.id}`}
                    className={`rounded-xl border p-2.5 text-xs transition ${
                      fb.draft
                        ? 'border-dashed border-amber-300 bg-amber-50/50'
                        : 'border-border bg-surface'
                    } ${isFocused ? 'ring-2 ring-violet-400' : ''}`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-1.5">
                      <div className="flex items-center gap-1.5">
                        <Badge tone={statusMeta.tone}>{statusMeta.label}</Badge>
                        {thread?.resolution ? <Badge tone="ok">线程已解决</Badge> : null}
                        <span className="text-[11px] font-medium text-ink-muted">
                          {feedbackKindLabel(fb.kind)}
                        </span>
                        {isOldVersion ? (
                          <Badge tone="off" data-testid={`old-version-badge-${fb.id}`}>
                            针对 v{fb.version}
                          </Badge>
                        ) : (
                          <span className="text-[11px] text-ink-muted">v{fb.version}</span>
                        )}
                      </div>
                      <span className="flex items-center gap-1.5 text-[10px] text-ink-muted">
                        <span>{fb.author}</span>
                        <time
                          dateTime={fb.createdAt}
                          title={new Date(fb.createdAt).toLocaleString()}
                        >
                          {formatRelativeTime(fb.createdAt)}
                        </time>
                      </span>
                    </div>
                    {isOldVersion && locator ? (
                      <p className="mt-1 truncate text-[11px] text-ink-muted">
                        {fb.element?.boardId ? `${fb.element.boardId} · ` : ''}
                        {locator}
                      </p>
                    ) : null}

                    {isOldVersion ? (
                      <a
                        className="mt-1.5 inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[11px] text-ink hover:underline"
                        href={`/a/${encodeURIComponent(artifactId)}/v/${fb.version}${window.location.search}#thread=${encodeURIComponent(fb.id)}`}
                      >
                        <Target size={10} />回 v{fb.version} 定位
                      </a>
                    ) : fb.element && locator ? (
                      <button
                        type="button"
                        onClick={() => {
                          setFocusedFeedbackId(fb.id)
                          onFocusThread?.(fb)
                        }}
                        className="mt-1.5 inline-flex max-w-full items-center gap-1 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-ink-muted hover:text-ink"
                      >
                        <Target size={10} className="shrink-0" />
                        <span className="truncate">
                          {fb.element.boardId ? `${fb.element.boardId} · ` : ''}
                          {locator}
                        </span>
                      </button>
                    ) : null}
                    {points ? (
                      <details className="mt-1 text-ink-muted">
                        <summary className="cursor-pointer">查看圈选数据</summary>
                        <ul className="mt-1 space-y-1">
                          {points.points.map((point) => (
                            <li key={point.id}>
                              {point.label}：{point.value} {points.valueLabel}
                            </li>
                          ))}
                        </ul>
                      </details>
                    ) : null}

                    <p className="mt-1.5 whitespace-pre-wrap break-words text-xs leading-relaxed text-ink">
                      {fb.body}
                    </p>
                    {isAnnotationKind(fb.kind) ? (
                      <AnnotationThreadActions
                        artifactId={artifactId}
                        feedbackId={fb.id}
                        thread={thread}
                        readOnly={!canComment}
                      />
                    ) : null}
                  </div>
                )
              })
            )}
          </div>
        </div>
      </SheetBody>
      {activeRound ? (
        <RoundSubmitBar
          artifactId={artifactId}
          projectId={projectId}
          activeRound={activeRound}
          feedbacks={feedbacks}
        />
      ) : null}
    </>
  )
}

/**
 * 批注与评审的非模态抽屉，开合不改变画布尺寸。
 */
export function InspectorPanel(props: InspectorPanelProps) {
  const open = useWorkspaceStore((s) => s.inspectorTab === 'review')
  const setTab = useWorkspaceStore((s) => s.setInspectorTab)

  return (
    <Sheet modal={false} open={open} onOpenChange={(next) => setTab(next ? 'review' : null)}>
      <SheetContent
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
