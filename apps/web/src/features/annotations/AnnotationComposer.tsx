import type { ElementRef, FeedbackKind, ReviewRound } from '@akasha/protocol'
import { Badge } from '@akasha/ui/badge'
import { Button } from '@akasha/ui/button'
import { Send, Target, X } from 'lucide-react'
import { useRef } from 'react'
import { toast } from 'sonner'
import { useSubmitFeedbackMutation } from '../../entities/feedback/queries'
import { useSelectionStore } from '../../entities/selection/store'
import { useWorkspaceStore } from '../../entities/workspace/store'

export interface AnnotationComposerProps {
  artifactId: string
  projectId: string
  version: number
  activeDraftingRound: ReviewRound | null
  selectedElement: ElementRef | null
  onSubmitFeedback?: (input: {
    project: string
    version: number
    roundId: string | null
    kind: FeedbackKind
    element: ElementRef | null
    body: string
  }) => Promise<unknown>
}

function elementLabel(el: ElementRef): string {
  if (el.blockId) return `#${el.blockId}`
  if (el.loc) return `源码 ${el.loc}`
  if (el.selector) return el.selector.slice(0, 36)
  return el.textPreview?.slice(0, 28) ?? '已选元素'
}

// L1 批注撰写器：基于选中元素/块创建批注或「让 Agent 改这里」，在活跃草稿轮次中自动标为草稿不中途唤醒 Agent。
export function AnnotationComposer({
  artifactId,
  projectId,
  version,
  activeDraftingRound,
  selectedElement,
  onSubmitFeedback,
}: AnnotationComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const draftText = useWorkspaceStore((s) => s.unsentDraftsByArtifact[artifactId] ?? '')
  const setUnsentDraft = useWorkspaceStore((s) => s.setUnsentDraft)
  const clearSelection = useSelectionStore((s) => s.clearSelection)
  const submitMutation = useSubmitFeedbackMutation(artifactId)

  const handleSubmit = async (kind: FeedbackKind) => {
    const body = draftText.trim()
    if (!body) {
      textareaRef.current?.focus()
      return
    }
    const payload = {
      project: projectId,
      version,
      roundId: activeDraftingRound ? activeDraftingRound.id : null,
      kind,
      element: selectedElement,
      body,
    }
    try {
      if (onSubmitFeedback) {
        await onSubmitFeedback(payload)
      } else {
        await submitMutation.mutateAsync(payload)
      }
      setUnsentDraft(artifactId, '')
      toast.success(
        activeDraftingRound ? '已保存为本轮草稿（提交本轮后统一送达 Agent）' : '批注已发送给 Agent',
      )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '提交批注失败')
    }
  }

  return (
    <div className="rounded-xl border border-border bg-surface p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-ink">
          {selectedElement ? '针对选中元素批注' : '全局批注'}
        </span>
        {activeDraftingRound ? (
          <Badge tone="warning">本轮草稿模式</Badge>
        ) : (
          <Badge tone="neutral">v{version}</Badge>
        )}
      </div>

      {selectedElement ? (
        <div className="mb-2 flex items-center justify-between gap-2 rounded-lg border border-violet-200 bg-violet-50/70 px-2.5 py-1.5 text-[11px] text-violet-950">
          <div className="flex min-w-0 items-center gap-1.5">
            <Target size={12} className="shrink-0 text-violet-600" />
            <span className="truncate font-mono font-medium">{elementLabel(selectedElement)}</span>
            {selectedElement.textPreview ? (
              <span className="truncate text-violet-700/80">
                「{selectedElement.textPreview.slice(0, 24)}」
              </span>
            ) : null}
          </div>
          <button
            type="button"
            aria-label="清除选中元素"
            onClick={() => clearSelection(artifactId)}
            className="shrink-0 rounded p-0.5 text-violet-600 hover:bg-violet-100"
          >
            <X size={12} />
          </button>
        </div>
      ) : null}

      <textarea
        ref={textareaRef}
        aria-label="批注内容"
        rows={3}
        value={draftText}
        onChange={(e) => setUnsentDraft(artifactId, e.target.value)}
        placeholder={
          selectedElement
            ? '说明希望 Agent 对这个元素做什么修改…'
            : '给这一版留批注，或先在画布工具栏指认元素…'
        }
        className="w-full resize-none rounded-lg border border-border bg-surface p-2 text-xs text-ink placeholder:text-ink-muted focus:border-accent focus:outline-none"
      />

      <div className="mt-2 flex flex-wrap items-center justify-between gap-1.5">
        {selectedElement ? (
          <Button
            variant="outline"
            size="sm"
            loading={submitMutation.isPending}
            onClick={() => {
              if (!draftText.trim()) {
                setUnsentDraft(artifactId, `请调整 ${elementLabel(selectedElement)}：`)
                textareaRef.current?.focus()
                return
              }
              void handleSubmit('request_changes')
            }}
          >
            让 Agent 改这里
          </Button>
        ) : (
          <span className="text-[11px] text-ink-muted">
            {activeDraftingRound ? '草稿不中途打断 Agent' : '提交后携带当前版本与定位'}
          </span>
        )}

        <Button
          variant="primary"
          size="sm"
          leftIcon={<Send size={12} />}
          disabled={!draftText.trim()}
          loading={submitMutation.isPending}
          onClick={() => void handleSubmit('comment')}
        >
          {activeDraftingRound ? '存为本轮草稿' : '发送批注'}
        </Button>
      </div>
    </div>
  )
}
