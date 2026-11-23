import type { AnnotationThread } from '@akasha/protocol'
import { Button } from '@akasha/ui/button'
import { useId, useState } from 'react'
import { readReplyDraft, writeReplyDraft } from '../../entities/feedback/annotation-draft'
import { useAnnotationThreadMutation } from '../../entities/feedback/queries'
import { formatRelativeTime } from '../../shared/lib/format'

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
  const key = useId()
  const [body, setBody] = useState(() => readReplyDraft(artifactId, feedbackId))
  const [replyOpen, setReplyOpen] = useState(Boolean(body))
  const update = useAnnotationThreadMutation(artifactId, feedbackId)
  const resolution = thread?.resolution

  async function sendReply() {
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
        <ul className="space-y-2 border-l border-border pl-2.5">
          {thread.replies.map((reply) => (
            <li key={reply.id}>
              <div className="flex flex-wrap items-center gap-x-2 text-[11px] text-ink-muted">
                <span className="font-medium">{reply.author}</span>
                <time dateTime={reply.createdAt} title={new Date(reply.createdAt).toLocaleString()}>
                  {formatRelativeTime(reply.createdAt)}
                </time>
              </div>
              <p className="mt-0.5 whitespace-pre-wrap break-words text-ink">{reply.body}</p>
            </li>
          ))}
        </ul>
      ) : null}
      {resolution ? (
        <p className="text-[11px] text-ink-muted">
          {resolution.author} ·{' '}
          <time dateTime={resolution.resolvedAt}>{formatRelativeTime(resolution.resolvedAt)}</time>
          解决
        </p>
      ) : null}
      {!readOnly ? (
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
            回复
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={update.isPending}
            onClick={() => update.mutate({ kind: 'resolve', resolved: !resolution })}
          >
            {resolution ? '重新打开' : '解决线程'}
          </Button>
        </div>
      ) : null}
      {!readOnly && replyOpen ? (
        <form
          id={key}
          onSubmit={(event) => {
            event.preventDefault()
            void sendReply()
          }}
        >
          <textarea
            aria-label="回复内容"
            value={body}
            rows={2}
            maxLength={8000}
            readOnly={update.isPending}
            onChange={(event) => {
              setBody(event.target.value)
              writeReplyDraft(artifactId, feedbackId, event.target.value)
            }}
            className="block w-full rounded-md border border-border bg-surface p-2 text-xs text-ink"
          />
          <Button
            size="sm"
            type="submit"
            className="mt-1.5"
            disabled={!body.trim() || update.isPending}
          >
            发送回复
          </Button>
        </form>
      ) : null}
      {update.error ? (
        <p role="alert" className="text-error">
          {update.error.message}
        </p>
      ) : null}
    </div>
  )
}
