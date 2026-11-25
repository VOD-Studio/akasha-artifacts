import type { AnnotationThread } from '@akasha/protocol'
import { Button } from '@akasha/ui/button'
import { Textarea } from '@akasha/ui/textarea'
import { useId, useState } from 'react'
import { readReplyDraft, useAnnotationThreadMutation, writeReplyDraft } from '@/entities/feedback'
import { isAccessDenied } from '@/shared/api/error'
import { useMessages } from '@/shared/i18n'
import { formatRelativeTime } from '@/shared/lib/format'
import { panelMessages } from '../messages'

interface AnnotationThreadActionsProps {
  artifactId: string
  feedbackId: string
  /** 展示记录与 Agent 消费状态独立；缺省表示没有回复或解决记录。 */
  thread?: AnnotationThread
  readOnly?: boolean
}

/** 在批注原版本下继续讨论，不把回复或解决动作交给 Agent。 */
export function AnnotationThreadActions({
  artifactId,
  feedbackId,
  thread,
  readOnly = false,
}: AnnotationThreadActionsProps) {
  const { t, locale, date } = useMessages(panelMessages)
  const key = useId()
  const [body, setBody] = useState(() => readReplyDraft(artifactId, feedbackId))
  const [replyOpen, setReplyOpen] = useState(Boolean(body))
  const update = useAnnotationThreadMutation(artifactId, feedbackId)
  const writable = !readOnly && !isAccessDenied(update.error)
  const resolution = thread?.resolution
  const sending = update.isPending && update.variables?.kind === 'reply'
  const resolving = update.isPending && update.variables?.kind === 'resolve'

  const sendReply = async () => {
    const reply = body.trim()
    if (!reply || update.isPending) return
    try {
      await update.mutateAsync({ kind: 'reply', body: reply })
      writeReplyDraft(artifactId, feedbackId, '')
      setBody('')
      setReplyOpen(false)
    } catch {
      // 保留未发送的正文；具体失败原因由 mutation.error 展示。
    }
  }

  return (
    <div className="mt-2 space-y-2 border-t border-border pt-2">
      {thread?.replies.length ? (
        <ul className="space-y-2 border-s border-border ps-2.5">
          {thread.replies.map((reply) => (
            <li key={reply.id}>
              <div className="flex flex-wrap items-center gap-x-2 text-[11px] text-ink-muted">
                <bdi className="font-medium">{reply.author}</bdi>
                <time
                  dir="ltr"
                  dateTime={reply.createdAt}
                  title={date(reply.createdAt, { dateStyle: 'medium', timeStyle: 'short' })}
                >
                  {formatRelativeTime(reply.createdAt, undefined, locale)}
                </time>
              </div>
              <p dir="auto" className="mt-0.5 whitespace-pre-wrap break-words text-ink">
                {reply.body}
              </p>
            </li>
          ))}
        </ul>
      ) : null}
      {resolution ? (
        <p className="text-[11px] text-ink-muted">
          <bdi>{resolution.author}</bdi> {t('已解决')} ·{' '}
          <time dir="ltr" dateTime={resolution.resolvedAt}>
            {formatRelativeTime(resolution.resolvedAt, undefined, locale)}
          </time>
        </p>
      ) : null}
      {writable ? (
        <div className="flex flex-wrap gap-1.5">
          <Button
            size="sm"
            variant="ghost"
            aria-expanded={replyOpen}
            aria-controls={key}
            disabled={update.isPending}
            onClick={() => {
              update.reset()
              setReplyOpen(!replyOpen)
            }}
          >
            {t('回复')}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={update.isPending}
            loading={resolving}
            onClick={() => update.mutate({ kind: 'resolve', resolved: !resolution })}
          >
            {resolution ? t('重新打开') : t('标为已解决')}
          </Button>
        </div>
      ) : null}
      {writable && replyOpen ? (
        <form
          id={key}
          onSubmit={(event) => {
            event.preventDefault()
            void sendReply()
          }}
        >
          <Textarea
            dir="auto"
            aria-label={t('回复内容')}
            value={body}
            rows={2}
            maxLength={8000}
            readOnly={update.isPending}
            onChange={(event) => {
              setBody(event.target.value)
              writeReplyDraft(artifactId, feedbackId, event.target.value)
            }}
          />
          <Button
            size="sm"
            type="submit"
            className="mt-1.5"
            disabled={!body.trim() || update.isPending}
            loading={sending}
          >
            {t('发送')}
          </Button>
        </form>
      ) : null}
      {!readOnly && !writable && replyOpen && body && (
        <Textarea dir="auto" aria-label={t('回复内容')} value={body} readOnly />
      )}
      {update.error ? (
        <p role="alert" className="text-error">
          {isAccessDenied(update.error) ? t('没有批注权限') : update.error.message}
        </p>
      ) : null}
    </div>
  )
}
