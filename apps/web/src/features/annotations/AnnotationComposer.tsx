import type { ElementRef, Feedback, FeedbackKind, ReviewRound } from '@akasha/protocol'
import { Badge } from '@akasha/ui/badge'
import { Button } from '@akasha/ui/button'
import { Checkbox } from '@akasha/ui/checkbox'
import { Textarea } from '@akasha/ui/textarea'
import { Send, Target, X } from 'lucide-react'
import { useId, useRef, useState } from 'react'
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

function submittedMessage(audience: Feedback['audience'], roundId: string | null) {
  if (roundId && audience === 'human') return '已保存讨论草稿'
  if (roundId) return '已保存草稿，提交本轮时发给 Agent'
  if (audience === 'human') return '已发送，仅供讨论'
  return '已发送给 Agent'
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
  const notifyId = useId()
  const [pendingKind, setPendingKind] = useState<'comment' | 'request_changes' | null>(null)
  const [draft, setDraft] = useState(() => readAnnotationDraft(artifactId))
  const draftText = draft?.body ?? ''
  const target = draft?.body ? draft.element : selectedElement
  const targetVersion = draft?.body ? draft.version : version
  const roundId = draft?.body ? draft.roundId : (activeDraftingRound?.id ?? null)
  const wrongVersion = targetVersion !== version
  const roundChanged = roundId !== null && roundId !== activeDraftingRound?.id
  const clearSelection = useSelectionStore((s) => s.clearSelection)
  const submitMutation = useSubmitFeedbackMutation(artifactId)
  const locked = wrongVersion || roundChanged || pendingKind !== null
  const showAgentAction = Boolean(target && notifyAgent)
  const canSaveDraft = roundId !== null && !wrongVersion && !roundChanged

  const replaceDraft = (next: AnnotationDraft | null) => {
    setDraft(next)
    writeAnnotationDraft(artifactId, next)
  }

  const changeDraft = (changes: Partial<AnnotationDraft>) => {
    replaceDraft({
      body: draftText,
      sendToAgent: draft?.sendToAgent ?? false,
      element: target,
      version: targetVersion,
      roundId,
      ...changes,
    })
  }

  const handleSubmit = async (kind: 'comment' | 'request_changes') => {
    if (locked) return
    const body = draftText.trim()
    if (!body) {
      textareaRef.current?.focus()
      return
    }
    const commentAudience = notifyAgent && draft?.sendToAgent ? 'agent' : 'human'
    const audience: Feedback['audience'] = kind === 'comment' ? commentAudience : undefined
    const payload = {
      project: projectId,
      version,
      roundId,
      kind,
      audience,
      element: target,
      body,
    }
    setPendingKind(kind)
    try {
      if (onSubmitFeedback) {
        await onSubmitFeedback(payload)
      } else {
        await submitMutation.mutateAsync(payload)
      }
      replaceDraft(null)
      toast.success(submittedMessage(audience, roundId))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '提交批注失败')
    } finally {
      setPendingKind(null)
    }
  }

  const requestChanges = () => {
    if (!target || !notifyAgent || locked) return
    if (!draftText.trim()) {
      changeDraft({ body: `请调整 ${elementLabel(target)}：` })
      textareaRef.current?.focus()
      return
    }
    void handleSubmit('request_changes')
  }

  return (
    <div className="rounded-xl border border-border bg-surface p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-ink">{target ? '元素批注' : '版本批注'}</span>
        {canSaveDraft ? (
          <Badge tone="warning">本轮草稿</Badge>
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
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            aria-label="清除选中元素"
            disabled={locked}
            onClick={() => {
              clearSelection(artifactId)
              if (draft?.body) changeDraft({ element: null })
            }}
            className="shrink-0"
          >
            <X size={12} />
          </Button>
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

      {(wrongVersion || roundChanged) && (
        <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-ink-muted">
          {wrongVersion && (
            <a
              className="font-medium text-accent underline underline-offset-2"
              href={`/a/${encodeURIComponent(artifactId)}/v/${targetVersion}${window.location.search}`}
            >
              回 v{targetVersion} 继续
            </a>
          )}
          {!wrongVersion && (
            <>
              <span>原轮次已变更。</span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => changeDraft({ roundId: null, sendToAgent: false })}
              >
                转为独立批注
              </Button>
            </>
          )}
          <Button variant="ghost" size="sm" onClick={() => replaceDraft(null)}>
            放弃草稿
          </Button>
        </div>
      )}

      <Textarea
        ref={textareaRef}
        aria-label="批注内容"
        rows={3}
        value={draftText}
        readOnly={locked}
        onChange={(event) => changeDraft({ body: event.target.value })}
        placeholder="输入批注"
      />

      {notifyAgent && (
        <label htmlFor={notifyId} className="mt-2 flex items-center gap-2 text-xs text-ink">
          <Checkbox
            id={notifyId}
            checked={draft?.sendToAgent ?? false}
            disabled={locked}
            onCheckedChange={(checked) => changeDraft({ sendToAgent: checked === true })}
          />
          {roundId ? '随本轮发给 Agent' : '同时发送给 Agent'}
        </label>
      )}

      <div className="mt-2 flex flex-wrap items-center justify-end gap-1.5">
        {showAgentAction && (
          <Button
            variant="outline"
            size="sm"
            disabled={locked}
            loading={pendingKind === 'request_changes'}
            onClick={requestChanges}
            className="me-auto"
          >
            让 Agent 改这里
          </Button>
        )}

        <Button
          variant="primary"
          size="sm"
          leftIcon={<Send size={12} />}
          disabled={locked || !draftText.trim()}
          loading={pendingKind === 'comment'}
          onClick={() => void handleSubmit('comment')}
        >
          {roundId ? '保存草稿' : '发送'}
        </Button>
      </div>
    </div>
  )
}
