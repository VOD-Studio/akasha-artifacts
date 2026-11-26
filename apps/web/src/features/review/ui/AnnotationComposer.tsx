import type { ElementRef, Feedback, FeedbackKind, ReviewRound } from '@akasha/protocol'
import { Badge } from '@akasha/ui/badge'
import { Button } from '@akasha/ui/button'
import { Checkbox } from '@akasha/ui/checkbox'
import { ScrollArea } from '@akasha/ui/scroll-area'
import { ArrowUp, Target, X } from 'lucide-react'
import { useId, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  type AnnotationDraft,
  readAnnotationDraft,
  writeAnnotationDraft,
} from '@/entities/feedback'
import { useSelectionStore } from '@/entities/selection'
import { isAccessDenied } from '@/shared/api/error'
import { useMessages } from '@/shared/i18n'
import { useSubmitFeedbackMutation } from '../api/mutations'
import { panelMessages } from '../messages'

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

function elementLabel(
  el: ElementRef,
  t: ReturnType<typeof useMessages<typeof panelMessages>>['t'],
): string {
  if (el.dataPoints)
    return t('{title} · {count} 个数据点', {
      title: el.dataPoints.chartTitle,
      count: el.dataPoints.points.length,
    })
  if (el.blockId?.startsWith('pr-line:') && el.textPreview) return el.textPreview
  if (el.blockId) return `#${el.blockId}`
  if (el.loc) return t('源码 {loc}', { loc: el.loc })
  if (el.selector) return el.selector.slice(0, 36)
  return el.textPreview?.slice(0, 28) ?? t('已选元素')
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
  const { t } = useMessages(panelMessages)
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
  const [denied, setDenied] = useState(false)
  const locked = denied || wrongVersion || roundChanged || pendingKind !== null
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
      toast.success(t(submittedMessage(audience, roundId)))
    } catch (err) {
      if (isAccessDenied(err)) setDenied(true)
      else toast.error(err instanceof Error ? err.message : t('提交批注失败'))
    } finally {
      setPendingKind(null)
    }
  }

  const requestChanges = () => {
    if (!target || !notifyAgent || locked) return
    if (!draftText.trim()) {
      changeDraft({ body: t('请调整 {target}：', { target: elementLabel(target, t) }) })
      textareaRef.current?.focus()
      return
    }
    void handleSubmit('request_changes')
  }

  return (
    <div className="rounded-xl border border-border/90 bg-surface p-3 shadow-2xs">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-ink">
          {target ? t('元素批注') : t('版本批注')}
        </span>
        {canSaveDraft ? (
          <Badge tone="warning">{t('本轮草稿')}</Badge>
        ) : (
          <span className="rounded-full bg-surface-subtle px-1.5 py-0.5 font-mono text-[10px] text-ink-muted tabular-nums">
            v{targetVersion}
          </span>
        )}
      </div>

      {target ? (
        <div className="mb-2 flex items-center justify-between gap-1.5 rounded-lg border border-(--canvas-selection-border) bg-(--canvas-selection-tint-soft) px-2 py-1 text-xs text-(--canvas-selection-strong)">
          <div className="flex min-w-0 items-center gap-1.5">
            <Target size={12} className="shrink-0" />
            <span className="truncate font-mono text-[11px] font-medium">
              {elementLabel(target, t)}
            </span>
            {target.textPreview && !target.dataPoints && !target.blockId?.startsWith('pr-line:') ? (
              <span className="truncate text-[11px] text-ink-muted">
                「{target.textPreview.slice(0, 24)}」
              </span>
            ) : null}
          </div>
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            aria-label={t('清除选中元素')}
            disabled={locked}
            onClick={() => {
              clearSelection(artifactId)
              if (draft?.body) changeDraft({ element: null })
            }}
            className="size-5 shrink-0 rounded-full"
          >
            <X size={11} />
          </Button>
        </div>
      ) : null}

      {target?.dataPoints && (
        <details className="mb-2 rounded-lg border border-border px-2.5 py-1.5 text-xs text-ink">
          <summary className="cursor-pointer">
            {target.dataPoints.valueLabel} · {t('所选数据点')}
          </summary>
          <ScrollArea
            aria-label={t('所选数据点')}
            tabIndex={-1}
            className="mt-1 max-h-36 [--v-scroll-area-padding:0px] [--v-scroll-area-surface:var(--card)]"
          >
            <ul className="list-disc space-y-1 ps-4">
              {target.dataPoints.points.map((point) => (
                <li key={point.id} className="break-words">
                  {point.label || t('（空白）')}：{point.value}
                </li>
              ))}
            </ul>
          </ScrollArea>
        </details>
      )}

      {(wrongVersion || roundChanged) && (
        <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-ink-muted">
          {wrongVersion && (
            <a
              className="font-medium text-(--canvas-selection-strong) underline underline-offset-2"
              href={`/a/${encodeURIComponent(artifactId)}/v/${targetVersion}${window.location.search}`}
            >
              {t('回 {version} 继续', { version: `v${targetVersion}` })}
            </a>
          )}
          {!wrongVersion && (
            <>
              <span>{t('原轮次已变更。')}</span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => changeDraft({ roundId: null, sendToAgent: false })}
              >
                {t('转为独立批注')}
              </Button>
            </>
          )}
          <Button variant="ghost" size="sm" onClick={() => replaceDraft(null)}>
            {t('放弃草稿')}
          </Button>
        </div>
      )}

      <textarea
        ref={textareaRef}
        dir="auto"
        aria-label={t('批注内容')}
        rows={3}
        value={draftText}
        readOnly={locked}
        onChange={(event) => changeDraft({ body: event.target.value })}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault()
            void handleSubmit('comment')
          }
        }}
        placeholder={t('输入批注')}
        className="block w-full resize-none rounded-lg border border-border/70 bg-surface-subtle/40 px-2.5 py-2 text-[13px] leading-relaxed text-ink outline-none transition-colors caret-(--canvas-selection) placeholder:text-ink-muted/65 focus:border-(--canvas-selection-border) focus:bg-surface"
      />

      {denied && <p role="alert">{t('没有批注权限')}</p>}
      {!denied && notifyAgent && (
        <label
          htmlFor={notifyId}
          className="mt-2 flex cursor-pointer items-center gap-1.5 text-xs text-ink select-none"
        >
          <Checkbox
            id={notifyId}
            checked={draft?.sendToAgent ?? false}
            disabled={locked}
            onCheckedChange={(checked) => changeDraft({ sendToAgent: checked === true })}
          />
          {roundId ? t('随本轮发给 Agent') : t('同时发送给 Agent')}
        </label>
      )}

      {!denied && (
        <div className="mt-2.5 flex flex-wrap items-center justify-end gap-1.5">
          {showAgentAction && (
            <Button
              variant="ghost"
              size="sm"
              disabled={locked}
              loading={pendingKind === 'request_changes'}
              onClick={requestChanges}
              className="me-auto h-7 px-2 text-xs text-ink-muted hover:text-ink"
            >
              {t('让 Agent 改这里')}
            </Button>
          )}

          <Button
            variant="primary"
            size="sm"
            leftIcon={<ArrowUp size={12} />}
            disabled={locked || !draftText.trim()}
            loading={pendingKind === 'comment'}
            onClick={() => void handleSubmit('comment')}
            className="h-7 rounded-lg bg-(--canvas-selection) px-2.5 text-xs text-(--canvas-selection-foreground) hover:bg-(--canvas-selection-strong)"
          >
            {roundId ? t('保存草稿') : t('发送')}
          </Button>
        </div>
      )}
    </div>
  )
}
