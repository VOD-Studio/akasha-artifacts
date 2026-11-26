import type { ElementRef, Feedback, ReviewRound } from '@akasha/protocol'
import { Badge } from '@akasha/ui/badge'
import { Button } from '@akasha/ui/button'
import { Checkbox } from '@akasha/ui/checkbox'
import { Textarea } from '@akasha/ui/textarea'
import { MessageSquareText, Send, Target, X } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { toast } from 'sonner'
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
  version: number
  target: AnchoredAnnotationTarget
  /** 当前草拟中的评审轮次；存在时保存为本轮草稿，提交本轮后才投递 Agent。 */
  activeDraftingRound: ReviewRound | null
  /** 访客与分享会话为 false，不提供投递给本机 Agent 的选项。 */
  notifyAgent: boolean
  onClose: () => void
  onOpenAllDiscussions: () => void
  onSubmitted?: (feedback: Feedback) => void
}

function targetSummary(
  target: AnchoredAnnotationTarget,
  t: ReturnType<typeof useMessages<typeof panelMessages>>['t'],
): string {
  if (target.label) return target.label
  const el = target.element
  if (el.textPreview) return el.textPreview.slice(0, 32)
  if (el.blockId) return `#${el.blockId}`
  if (el.loc) return t('源码 {loc}', { loc: el.loc })
  if (el.selector) return el.selector.slice(0, 36)
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
 * 逐条勾选后才发给 Agent，不强制展开全部讨论抽屉。
 */
export function AnchoredAnnotationComposer({
  artifactId,
  projectId,
  version,
  target,
  activeDraftingRound,
  notifyAgent,
  onClose,
  onOpenAllDiscussions,
  onSubmitted,
}: AnchoredAnnotationComposerProps) {
  const { t, dir } = useMessages(panelMessages)
  const headingId = useId()
  const notifyId = useId()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [body, setBody] = useState('')
  const [sendToAgent, setSendToAgent] = useState(false)
  const [denied, setDenied] = useState(false)
  const submitMutation = useSubmitFeedbackMutation(artifactId)
  const roundId = activeDraftingRound?.id ?? null
  const busy = submitMutation.isPending
  const locked = denied || busy
  const isBoardOnly =
    Boolean(target.element.boardId) &&
    target.element.blockId === target.element.boardId &&
    !target.element.selector &&
    !target.element.loc

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
        version,
        roundId,
        kind: 'comment',
        audience,
        element: target.element,
        body: trimmed,
      })
      toast.success(t(submittedMessage(audience, roundId)))
      onSubmitted?.(feedback)
      onClose()
    } catch (err) {
      if (isAccessDenied(err)) setDenied(true)
      else toast.error(err instanceof Error ? err.message : t('提交批注失败'))
    }
  }

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
          {roundId ? (
            <Badge tone="warning">{t('本轮草稿')}</Badge>
          ) : (
            <Badge tone="neutral">v{version}</Badge>
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

      <div className="mb-2 flex items-center gap-1.5 rounded-lg border border-border bg-selected px-2.5 py-1.5 text-[11px] text-selected-foreground">
        <Target size={12} className="shrink-0" />
        <span className="truncate font-mono font-medium">{targetSummary(target, t)}</span>
      </div>

      <Textarea
        ref={textareaRef}
        dir="auto"
        aria-label={t('批注内容')}
        rows={3}
        value={body}
        readOnly={locked}
        onChange={(event) => setBody(event.target.value)}
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
            onCheckedChange={(checked) => setSendToAgent(checked === true)}
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
