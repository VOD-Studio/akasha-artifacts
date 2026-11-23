import type { ArtifactType, ElementRef, Feedback, ReviewRound } from '@akasha/protocol'
import { Badge } from '@akasha/ui/badge'
import { ScrollArea } from '@akasha/ui/scroll-area'
import { SlidersHorizontal, Target, X } from 'lucide-react'
import { useSelectionStore } from '../../entities/selection/store'
import { useWorkspaceStore } from '../../entities/workspace/store'
import { AnnotationComposer } from '../../features/annotations/AnnotationComposer'
import { PropsPanel } from '../../features/props-panel/PropsPanel'
import { ReviewActionsBar } from '../../features/review-actions/ReviewActionsBar'
import { formatRelativeTime } from '../../shared/lib/format'
import { RoundSubmitBar } from '../RoundSubmitBar/RoundSubmitBar'

export interface InspectorPanelProps {
  artifactId: string
  projectId: string
  artifactType?: ArtifactType
  source?: string
  stateSnapshot?: Record<string, unknown>
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

const EMPTY_STATE_SNAPSHOT: Record<string, unknown> = {}

// 右侧评审与属性面板：支持 L1 批注/评审线程与 L2 Kit 模板属性表单切换（无属性 schema 时自动降级为 L1）。
export function InspectorPanel({
  artifactId,
  projectId,
  artifactType,
  source = '',
  stateSnapshot = EMPTY_STATE_SNAPSHOT,
  activeVersion,
  activeRound,
  feedbacks,
  onHighlightElement,
  onClose,
}: InspectorPanelProps) {
  const tab = useWorkspaceStore((s) => s.inspectorTab ?? 'review')
  const setTab = useWorkspaceStore((s) => s.setInspectorTab)
  const selectedElement = useSelectionStore((s) => s.selectedByArtifact[artifactId] ?? null)
  const focusedFeedbackId = useSelectionStore((s) => s.focusedFeedbackId)
  const setFocusedFeedbackId = useSelectionStore((s) => s.setFocusedFeedbackId)

  const ordered = [...feedbacks].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))

  return (
    <aside
      id="artifact-inspector"
      aria-label="批注与评审面板"
      data-testid="inspector-panel"
      className="flex max-h-[45%] min-h-0 shrink-0 flex-col border-t border-border bg-surface md:max-h-none md:w-80 md:border-t-0 md:border-l"
    >
      <div className="flex shrink-0 items-center justify-between border-b border-border px-3 py-2">
        <div className="flex items-center gap-1" role="tablist" aria-label="右侧面板切换">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'review'}
            onClick={() => setTab('review')}
            className={`inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-semibold transition ${
              tab === 'review' ? 'bg-muted text-ink' : 'text-ink-muted hover:text-ink'
            }`}
          >
            <span>批注与评审</span>
            {feedbacks.length > 0 ? <span>{feedbacks.length}</span> : null}
          </button>
          {artifactType ? (
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'props'}
              onClick={() => setTab('props')}
              className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold transition ${
                tab === 'props' ? 'bg-muted text-ink' : 'text-ink-muted hover:text-ink'
              }`}
            >
              <SlidersHorizontal size={12} />
              <span>属性</span>
            </button>
          ) : null}
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

      <ScrollArea aria-label="批注与评审详情" className="min-h-0 flex-1 p-3">
        {tab === 'props' && artifactType ? (
          <PropsPanel
            artifactId={artifactId}
            projectId={projectId}
            artifactType={artifactType}
            source={source}
            stateSnapshot={stateSnapshot}
            onFallbackToL1={() => setTab('review')}
          />
        ) : (
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
                <p className="py-2 text-xs text-ink-muted">暂无批注与反馈。</p>
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
        )}
      </ScrollArea>
      {activeRound && tab === 'review' ? (
        <RoundSubmitBar
          artifactId={artifactId}
          projectId={projectId}
          activeRound={activeRound}
          feedbacks={feedbacks}
        />
      ) : null}
    </aside>
  )
}
