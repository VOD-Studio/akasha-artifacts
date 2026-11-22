import type { ElementRef, Feedback, ReviewRound } from '@akasha/protocol'
import { Badge } from '@akasha/ui/badge'
import { Empty } from '@akasha/ui/empty'
import { ScrollArea } from '@akasha/ui/scroll-area'
import { MessageSquare, Target, X } from 'lucide-react'
import { useSelectionStore } from '../../entities/selection/store'
import { AnnotationComposer } from '../../features/annotations/AnnotationComposer'
import { ReviewActionsBar } from '../../features/review-actions/ReviewActionsBar'
import { formatRelativeTime } from '../../shared/lib/format'

export interface InspectorPanelProps {
  artifactId: string
  projectId: string
  activeVersion: number
  activeRound: ReviewRound | null
  feedbacks: readonly Feedback[]
  onHighlightElement?: (element: ElementRef) => void
  onClose: () => void
}

function feedbackStatusBadge(fb: Feedback): {
  label: string
  tone: 'warning' | 'accent' | 'ok' | 'neutral'
} {
  if (fb.draft) return { label: '草稿', tone: 'warning' }
  if (fb.status === 'resolved') return { label: '已解决', tone: 'ok' }
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

// 右侧评审与批注面板：展示选中元素撰写器、评审决策动作以及全量反馈线程（标注草稿/待处理/已送达/已解决与旧版「针对 vN」）。
export function InspectorPanel({
  artifactId,
  projectId,
  activeVersion,
  activeRound,
  feedbacks,
  onHighlightElement,
  onClose,
}: InspectorPanelProps) {
  const selectedElement = useSelectionStore((s) => s.selectedByArtifact[artifactId] ?? null)
  const focusedFeedbackId = useSelectionStore((s) => s.focusedFeedbackId)
  const setFocusedFeedbackId = useSelectionStore((s) => s.setFocusedFeedbackId)

  const ordered = [...feedbacks].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))

  return (
    <aside
      aria-label="批注与评审面板"
      data-testid="inspector-panel"
      className="flex w-[348px] shrink-0 flex-col border-l border-border bg-surface-subtle"
    >
      <div className="flex items-center justify-between border-b border-border bg-surface px-3.5 py-2.5">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-ink">
          <MessageSquare size={14} />
          <span>批注与评审</span>
          <Badge tone="neutral">{feedbacks.length}</Badge>
        </div>
        <button
          type="button"
          aria-label="收起批注面板"
          onClick={onClose}
          className="rounded p-1 text-ink-muted hover:bg-muted hover:text-ink"
        >
          <X size={14} />
        </button>
      </div>

      <ScrollArea aria-label="批注与评审详情" className="flex-1 p-3">
        <div className="space-y-3">
          <AnnotationComposer
            artifactId={artifactId}
            projectId={projectId}
            version={activeVersion}
            activeDraftingRound={activeRound?.status === 'drafting' ? activeRound : null}
            selectedElement={selectedElement}
          />

          <ReviewActionsBar
            artifactId={artifactId}
            projectId={projectId}
            version={activeVersion}
            activeRound={activeRound}
          />

          <div className="space-y-2 pt-1">
            <div className="text-[11px] font-medium text-ink-muted">
              反馈记录（{ordered.length}）
            </div>

            {ordered.length === 0 ? (
              <Empty
                variant="compact"
                title="暂无批注与反馈"
                description="点击顶栏「指认元素」或直接在此输入批注。"
              />
            ) : (
              ordered.map((fb) => {
                const statusMeta = feedbackStatusBadge(fb)
                const isOldVersion = fb.version !== activeVersion
                const isFocused = fb.id === focusedFeedbackId
                const locator = fb.element?.blockId
                  ? `#${fb.element.blockId}`
                  : fb.element?.loc
                    ? `@${fb.element.loc}`
                    : fb.element?.selector?.slice(0, 28)

                return (
                  <div
                    key={fb.id}
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
                        <span className="text-[11px] font-medium text-ink-muted">
                          {feedbackKindLabel(fb.kind)}
                        </span>
                        {isOldVersion ? (
                          <Badge tone="off" data-testid={`old-version-badge-${fb.id}`}>
                            针对 v{fb.version}
                          </Badge>
                        ) : null}
                      </div>
                      <span className="text-[10px] text-ink-muted">
                        {formatRelativeTime(fb.createdAt)}
                      </span>
                    </div>

                    {fb.element && locator ? (
                      <button
                        type="button"
                        onClick={() => {
                          setFocusedFeedbackId(fb.id)
                          if (fb.element) onHighlightElement?.(fb.element)
                        }}
                        className="mt-1.5 inline-flex max-w-full items-center gap-1 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-ink-muted hover:text-ink"
                      >
                        <Target size={10} className="shrink-0" />
                        <span className="truncate">{locator}</span>
                      </button>
                    ) : null}

                    <p className="mt-1.5 whitespace-pre-wrap break-words text-xs leading-relaxed text-ink">
                      {fb.body}
                    </p>
                  </div>
                )
              })
            )}
          </div>
        </div>
      </ScrollArea>
    </aside>
  )
}
