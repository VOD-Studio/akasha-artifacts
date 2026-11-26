import type { ElementRef, Feedback, ReviewRound } from '@akasha/protocol'
import { Badge } from '@akasha/ui/badge'
import { Button } from '@akasha/ui/button'
import { Checkbox } from '@akasha/ui/checkbox'
import { Textarea } from '@akasha/ui/textarea'
import { MessageSquareText, Send, Target, X } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { toast } from 'sonner'
import {
  type AnnotationDraft,
  readAnnotationDraft,
  writeAnnotationDraft,
} from '@/entities/feedback'
import { isAccessDenied } from '@/shared/api/error'
import { useMessages } from '@/shared/i18n'
import { useSubmitFeedbackMutation } from '../api/mutations'
import { panelMessages } from '../messages'

/** 选区旁批注浮层的锚点与目标引用；复用当前选区，不要求二次指认。 */
export interface AnchoredAnnotationTarget {
  /** 外壳屏幕坐标，用于将浮层贴靠在选中对象附近而不遮挡原对象。 */
  anchor: { x: number; y: number }
  /** 批注归属的对象或画板引用。 */
  element: ElementRef
  /** 可选的对象展示名（如画板名或图层标题）。 */
  label?: string
}

export interface AnchoredAnnotationComposerProps {
  artifactId: string
  projectId: string
  /** 当前工作区正在展示的版本；热更新推进后与草稿原版本对比以防错绑。 */
  version: number
  /** 发起本条选区批注时的固定版本，不随头版本热更新改写。 */
  originVersion: number
  target: AnchoredAnnotationTarget
  /** 当前草拟中的评审轮次；存在时保存为本轮草稿，提交本轮后才投递 Agent。 */
  activeDraftingRound: ReviewRound | null
  /** 访客与分享会话为 false，不提供投递给本机 Agent 的选项。 */
  notifyAgent: boolean
  onClose: () => void
  onOpenAllDiscussions: () => void
  onOpenVersion?: (version: number) => void
  onSubmitted?: (feedback: Feedback) => void
}

function targetSummary(
  element: ElementRef | null,
  fallbackLabel: string | undefined,
  t: ReturnType<typeof useMessages<typeof panelMessages>>['t'],
): string {
  if (fallbackLabel) return fallbackLabel
  if (!element) return t('已选元素')
  if (element.textPreview) return element.textPreview.slice(0, 32)
  if (element.blockId) return `#${element.blockId}`
  if (element.loc) return t('源码 {loc}', { loc: element.loc })
  if (element.selector) return element.selector.slice(0, 36)
  return t('已选元素')
}

function submittedMessage(audience: Feedback['audience'], roundId: string | null) {
  if (roundId && audience === 'human') return '已保存讨论草稿'
  if (roundId) return '已保存草稿，提交本轮时发给 Agent'
  if (audience === 'human') return '已发送，仅供讨论'
  return '已发送给 Agent'
}

/**
 * 贴靠选区对象的批注浮层：保留原对象在画面内，默认仅讨论不投递，
 * 逐条勾选后才发给 Agent，不强制展开全部讨论抽屉；热更新期间按 §7.3 保留原版本与草稿。
 */
export function AnchoredAnnotationComposer({
  artifactId,
  projectId,
  version,
  originVersion,
  target,
  activeDraftingRound,
  notifyAgent,
  onClose,
  onOpenAllDiscussions,
  onOpenVersion,
  onSubmitted,
}: AnchoredAnnotationComposerProps) {
  const { t, dir } = useMessages(panelMessages)
  const headingId = useId()
  const notifyId = useId()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [draft, setDraft] = useState<AnnotationDraft | null>(() => readAnnotationDraft(artifactId))
  const [sendToAgent, setSendToAgent] = useState(() => draft?.sendToAgent ?? false)
  const [denied, setDenied] = useState(false)
  const submitMutation = useSubmitFeedbackMutation(artifactId)

  const body = draft?.body ?? ''
  const targetElement = draft?.body ? draft.element : target.element
  const targetVersion = draft?.body ? draft.version : originVersion
  const roundId = draft?.body ? draft.roundId : (activeDraftingRound?.id ?? null)
  const wrongVersion = targetVersion !== version
  const roundChanged = roundId !== null && roundId !== activeDraftingRound?.id
  const busy = submitMutation.isPending
  const locked = denied || wrongVersion || roundChanged || busy
  const isBoardOnly =
    Boolean(targetElement?.boardId) &&
    targetElement?.blockId === targetElement?.boardId &&
    !targetElement?.selector &&
    !targetElement?.loc

  const replaceDraft = (next: AnnotationDraft | null) => {
    setDraft(next)
    writeAnnotationDraft(artifactId, next)
    if (!next) setSendToAgent(false)
  }

  const updateDraft = (changes: Partial<AnnotationDraft>) => {
    const nextSendToAgent = changes.sendToAgent ?? sendToAgent
    if (changes.sendToAgent !== undefined) setSendToAgent(changes.sendToAgent)
    const nextBody = changes.body ?? body
    if (!nextBody) {
      replaceDraft(null)
      setSendToAgent(nextSendToAgent)
      return
    }
    const next: AnnotationDraft = {
      body: nextBody,
      sendToAgent: nextSendToAgent,
      element: targetElement,
      version: targetVersion,
      roundId,
      ...changes,
    }
    setDraft(next)
    writeAnnotationDraft(artifactId, next)
  }

  useEffect(() => {
    const previous = document.activeElement
    textareaRef.current?.focus({ preventScroll: true })
    return () => {
      if (
        previous instanceof HTMLElement &&
        previous.isConnected &&
        document.activeElement === document.body
      ) {
        previous.focus({ preventScroll: true })
      }
    }
  }, [])

  const submit = async () => {
    const trimmed = body.trim()
    if (!trimmed || locked) {
      textareaRef.current?.focus()
      return
    }
    const audience: Feedback['audience'] = notifyAgent && sendToAgent ? 'agent' : 'human'
    try {
      const { feedback } = await submitMutation.mutateAsync({
        project: projectId,
        version: targetVersion,
        roundId,
        kind: 'comment',
        audience,
        element: targetElement,
        body: trimmed,
      })
      replaceDraft(null)
      toast.success(t(submittedMessage(audience, roundId)))
      onSubmitted?.(feedback)
      onClose()
    } catch (err) {
      if (isAccessDenied(err)) setDenied(true)
      else toast.error(err instanceof Error ? err.message : t('提交批注失败'))
    }
  }

  const returnHref = `/a/${encodeURIComponent(artifactId)}/v/${targetVersion}${window.location.search}`

  return createPortal(
    <dialog
      open
      dir={dir}
      data-testid="anchored-annotation-composer"
      aria-labelledby={headingId}
      className="fixed z-50 m-0 w-[min(21rem,calc(100vw-24px))] rounded-xl border border-border bg-surface p-3 text-ink shadow-lg"
      style={{
        left: `clamp(12px, ${target.anchor.x}px, calc(100vw - 22rem))`,
        top: `clamp(56px, ${target.anchor.y}px, calc(100dvh - 18rem))`,
      }}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return
        if (event.key === 'Escape' && !busy) {
          event.preventDefault()
          event.stopPropagation()
          event.nativeEvent.stopPropagation()
          onClose()
          return
        }
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
          event.preventDefault()
          void submit()
        }
      }}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <h2 id={headingId} className="text-xs font-semibold text-ink">
            {isBoardOnly ? t('画板批注') : t('元素批注')}
          </h2>
          {roundId && !wrongVersion && !roundChanged ? (
            <Badge tone="warning">{t('本轮草稿')}</Badge>
          ) : (
            <Badge tone="neutral">v{targetVersion}</Badge>
          )}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          iconOnly
          aria-label={t('关闭批注输入')}
          disabled={busy}
          onClick={onClose}
        >
          <X size={13} />
        </Button>
      </div>

      {targetElement ? (
        <div className="mb-2 flex items-center gap-1.5 rounded-lg border border-border bg-selected px-2.5 py-1.5 text-[11px] text-selected-foreground">
          <Target size={12} className="shrink-0" />
          <span className="truncate font-mono font-medium">
            {targetSummary(targetElement, draft?.body ? undefined : target.label, t)}
          </span>
        </div>
      ) : null}

      {(wrongVersion || roundChanged) && (
        <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-ink-muted">
          {wrongVersion ? (
            <a
              className="font-medium text-accent underline underline-offset-2"
              href={returnHref}
              onClick={(event) => {
                if (
                  !onOpenVersion ||
                  event.button !== 0 ||
                  event.metaKey ||
                  event.ctrlKey ||
                  event.shiftKey ||
                  event.altKey
                ) {
                  return
                }
                event.preventDefault()
                onOpenVersion(targetVersion)
              }}
            >
              {t('回 {version} 继续', { version: `v${targetVersion}` })}
            </a>
          ) : (
            <>
              <span>{t('原轮次已变更。')}</span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => updateDraft({ roundId: null, sendToAgent: false })}
              >
                {t('转为独立批注')}
              </Button>
            </>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              replaceDraft(null)
              if (wrongVersion) onClose()
            }}
          >
            {t('放弃草稿')}
          </Button>
        </div>
      )}

      <Textarea
        ref={textareaRef}
        dir="auto"
        aria-label={t('批注内容')}
        rows={3}
        value={body}
        readOnly={locked}
        onChange={(event) => updateDraft({ body: event.target.value })}
        placeholder={t('输入批注')}
      />

      {denied ? (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {t('没有批注权限')}
        </p>
      ) : null}

      {!denied && notifyAgent ? (
        <label htmlFor={notifyId} className="mt-2 flex items-center gap-2 text-xs text-ink">
          <Checkbox
            id={notifyId}
            checked={sendToAgent}
            disabled={locked}
            onCheckedChange={(checked) => updateDraft({ sendToAgent: checked === true })}
          />
          {roundId ? t('随本轮发给 Agent') : t('同时发送给 Agent')}
        </label>
      ) : null}

      <div className="mt-2.5 flex items-center justify-between gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          leftIcon={<MessageSquareText size={12} />}
          disabled={busy}
          onClick={() => {
            onClose()
            onOpenAllDiscussions()
          }}
        >
          {t('查看全部讨论')}
        </Button>
        {!denied ? (
          <Button
            type="button"
            variant="primary"
            size="sm"
            leftIcon={<Send size={12} />}
            disabled={locked || !body.trim()}
            loading={busy}
            onClick={() => void submit()}
          >
            {roundId ? t('保存草稿') : t('发送')}
          </Button>
        ) : null}
      </div>
    </dialog>,
    document.body,
  )
}
