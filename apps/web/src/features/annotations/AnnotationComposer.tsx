import type { ElementRef, Feedback, FeedbackKind, ReviewRound } from '@akasha/protocol'
import { Badge } from '@akasha/ui/badge'
import { Button } from '@akasha/ui/button'
import { Send, Target, X } from 'lucide-react'
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  type AnnotationDraft,
  readAnnotationDraft,
  writeAnnotationDraft,
} from '../../entities/feedback/annotation-draft'
import { useSubmitFeedbackMutation } from '../../entities/feedback/queries'
import { useSelectionStore } from '../../entities/selection/store'

export interface AnnotationComposerProps {
  artifactId: string
  projectId: string
  version: number
  /** 当前处于草稿状态的轮次；批注落在其中时自动标为草稿。 */
  activeDraftingRound: ReviewRound | null
  selectedElement: ElementRef | null
  notifyAgent?: boolean
  onSubmitFeedback?: (input: {
    project: string
    version: number
    roundId: string | null
    kind: FeedbackKind
    audience?: Feedback['audience']
    element: ElementRef | null
    body: string
  }) => Promise<unknown>
}

function elementLabel(el: ElementRef): string {
  if (el.dataPoints) return `${el.dataPoints.chartTitle} · ${el.dataPoints.points.length} 个数据点`
  if (el.blockId?.startsWith('pr-line:') && el.textPreview) return el.textPreview
  if (el.blockId) return `#${el.blockId}`
  if (el.loc) return `源码 ${el.loc}`
  if (el.selector) return el.selector.slice(0, 36)
  return el.textPreview?.slice(0, 28) ?? '已选元素'
}

/**
 * L1 批注撰写器：基于选中的元素或块创建批注，或发起「让 Agent 改这里」。
 *
 * @remarks 默认只供讨论；勾选投递的轮次草稿在本轮提交后才送达 Agent。
 */
export function AnnotationComposer({
  artifactId,
  projectId,
  version,
  activeDraftingRound,
  selectedElement,
  notifyAgent = true,
  onSubmitFeedback,
}: AnnotationComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [draft, setDraft] = useState(() => readAnnotationDraft(artifactId))
  const draftText = draft?.body ?? ''
  const target = draft?.body ? draft.element : selectedElement
  const targetVersion = draft?.body ? draft.version : version
  const roundId = draft?.body ? draft.roundId : (activeDraftingRound?.id ?? null)
  const wrongVersion = targetVersion !== version
  const roundChanged = roundId !== null && roundId !== activeDraftingRound?.id
  const clearSelection = useSelectionStore((s) => s.clearSelection)
  const submitMutation = useSubmitFeedbackMutation(artifactId)
  const locked = wrongVersion || roundChanged || submitMutation.isPending

  function replaceDraft(next: AnnotationDraft | null) {
    setDraft(next)
    writeAnnotationDraft(artifactId, next)
  }

  function changeDraft(changes: Partial<AnnotationDraft>) {
    replaceDraft({
      body: draftText,
      sendToAgent: draft?.sendToAgent ?? false,
      element: target,
      version: targetVersion,
      roundId,
      ...changes,
    })
  }

  const handleSubmit = async (kind: FeedbackKind) => {
    if (locked) return
    const body = draftText.trim()
    if (!body) {
      textareaRef.current?.focus()
      return
    }
    const audience: Feedback['audience'] =
      kind === 'comment' ? (notifyAgent && draft?.sendToAgent ? 'agent' : 'human') : undefined
    const payload = {
      project: projectId,
      version,
      roundId,
      kind,
      audience,
      element: target,
      body,
    }
    try {
      if (onSubmitFeedback) {
        await onSubmitFeedback(payload)
      } else {
        await submitMutation.mutateAsync(payload)
      }
      replaceDraft(null)
      toast.success(
        audience === 'human'
          ? roundId
            ? '已存为本轮讨论草稿'
            : '已保存批注，仅供讨论'
          : roundId
            ? '已存为草稿，提交本轮后送达 Agent'
            : '批注已发送给 Agent',
      )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '提交批注失败')
    }
  }

  return (
    <div className="rounded-xl border border-border bg-surface p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-ink">
          {target ? '针对选中元素批注' : '全局批注'}
        </span>
        {roundId && !wrongVersion && !roundChanged ? (
          <Badge tone="warning">本轮草稿模式</Badge>
        ) : (
          <Badge tone="neutral">v{targetVersion}</Badge>
        )}
      </div>

      {target ? (
        <div className="mb-2 flex items-center justify-between gap-2 rounded-lg border border-border bg-selected px-2.5 py-1.5 text-[11px] text-selected-foreground">
          <div className="flex min-w-0 items-center gap-1.5">
            <Target size={12} className="shrink-0" />
            <span className="truncate font-mono font-medium">{elementLabel(target)}</span>
            {target.textPreview && !target.dataPoints && !target.blockId?.startsWith('pr-line:') ? (
              <span className="truncate text-ink-muted">「{target.textPreview.slice(0, 24)}」</span>
            ) : null}
          </div>
          <button
            type="button"
            aria-label="清除选中元素"
            disabled={locked}
            onClick={() => {
              clearSelection(artifactId)
              if (draft?.body) changeDraft({ element: null })
            }}
            className="shrink-0 rounded p-0.5 hover:bg-selected-hover"
          >
            <X size={12} />
          </button>
        </div>
      ) : null}

      {target?.dataPoints && (
        <details className="mb-2 rounded-lg border border-border px-2.5 py-1.5 text-xs text-ink">
          <summary className="cursor-pointer">{target.dataPoints.valueLabel} · 所选数据点</summary>
          <ul className="mt-1 max-h-36 list-disc space-y-1 overflow-auto pl-4">
            {target.dataPoints.points.map((point) => (
              <li key={point.id} className="break-words">
                {point.label || '（空白）'}：{point.value}
              </li>
            ))}
          </ul>
        </details>
      )}

      {wrongVersion || roundChanged ? (
        <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-ink-muted">
          {wrongVersion ? (
            <a
              className="font-medium text-accent underline underline-offset-2"
              href={`/a/${encodeURIComponent(artifactId)}/v/${targetVersion}${window.location.search}`}
            >
              回 v{targetVersion} 继续
            </a>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={() => changeDraft({ roundId: null, sendToAgent: false })}
            >
              原轮次已变更，转为独立批注
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => replaceDraft(null)}>
            放弃草稿
          </Button>
        </div>
      ) : null}

      <textarea
        ref={textareaRef}
        aria-label="批注内容"
        rows={3}
        value={draftText}
        readOnly={locked}
        onChange={(e) => changeDraft({ body: e.target.value })}
        placeholder={target ? '对选中目标留下意见…' : '给这一版留批注，或先在画布工具栏指认元素…'}
        className="w-full resize-none rounded-lg border border-border bg-surface p-2 text-xs text-ink placeholder:text-ink-muted focus:border-accent focus:outline-none"
      />

      {notifyAgent ? (
        <label className="mt-2 flex items-center gap-2 text-xs text-ink">
          <input
            type="checkbox"
            checked={draft?.sendToAgent ?? false}
            disabled={locked}
            onChange={(event) => changeDraft({ sendToAgent: event.target.checked })}
          />
          同时发送给 Agent
        </label>
      ) : null}

      <div className="mt-2 flex flex-wrap items-center justify-between gap-1.5">
        {target && notifyAgent ? (
          <Button
            variant="outline"
            size="sm"
            disabled={locked}
            loading={submitMutation.isPending}
            onClick={() => {
              if (!draftText.trim()) {
                changeDraft({ body: `请调整 ${elementLabel(target)}：` })
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
            {roundId ? '草稿不中途打断 Agent' : '提交后携带当前版本与定位'}
          </span>
        )}

        <Button
          variant="primary"
          size="sm"
          leftIcon={<Send size={12} />}
          disabled={locked || !draftText.trim()}
          loading={submitMutation.isPending}
          onClick={() => void handleSubmit('comment')}
        >
          {roundId ? '存为本轮草稿' : '发送批注'}
        </Button>
      </div>
    </div>
  )
}
