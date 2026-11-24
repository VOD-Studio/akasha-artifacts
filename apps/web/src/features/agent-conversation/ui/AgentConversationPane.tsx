import type { AgentAvailability, ArtifactHandoffReference } from '@akasha/protocol'
import { Button } from '@akasha/ui/button'
import { Textarea } from '@akasha/ui/textarea'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Send, X } from 'lucide-react'
import { type ChangeEventHandler, type FormEventHandler, useLayoutEffect, useRef } from 'react'
import { ApiError } from '@/shared/api/error'
import { fetchArtifactConversation, sendArtifactConversation } from '../api/client'
import { useAgentDraft } from '../model/agent-draft'
import { AgentTurnList, describeAgentTarget } from './AgentTurnList'

export interface ConversationTarget {
  /** 用户看到的页面和画板名只用于显示；提交时发送准确引用。 */
  label: string
  /** 已保存的制品、快照、画板和运行对象。 */
  reference: ArtifactHandoffReference
}

interface PaneProps {
  artifactId: string
  projectId: string
  open: boolean
  target?: ConversationTarget
  onClearTarget: () => void
  onClose: () => void
}

function getConnectionNotice(
  artifactId: string,
  error: Error | null,
  availability?: AgentAvailability,
) {
  if (error instanceof ApiError && error.status === 401) {
    return { text: '登录本机作品库', command: `akasha open ${artifactId}` }
  }
  if (error) return { text: '无法读取会话' }
  if (availability === 'unbound') return { text: '未绑定会话' }
  if (availability === 'offline') {
    return { text: '在项目目录连接 Codex', command: 'akasha agent connect --project .' }
  }
  if (availability === 'busy') return { text: 'Codex 正忙' }
  if (availability === undefined) return { text: '正在连接…' }
  return null
}

/** 非模态并列区域：不可用与回复是不同状态；窄屏仍保留画布原来的尺寸与实例。 */
export function AgentConversationPane({
  artifactId,
  projectId,
  open,
  target,
  onClearTarget,
  onClose,
}: PaneProps) {
  const heading = useRef<HTMLHeadingElement>(null)
  useLayoutEffect(() => {
    if (open) heading.current?.focus({ preventScroll: true })
  }, [open])
  const [draft, setDraft] = useAgentDraft(`artifact:${projectId}/${artifactId}`)
  const queryClient = useQueryClient()
  const queryKey = ['artifact-agent-session', artifactId] as const
  const status = useQuery({
    queryKey,
    queryFn: ({ signal }) => fetchArtifactConversation(artifactId, signal),
    enabled: open,
    retry: false,
    refetchInterval: (query) => (query.state.data?.availability === 'busy' ? 1000 : 4000),
  })
  const send = useMutation({
    mutationFn: (input: { message: string; target?: ArtifactHandoffReference }) =>
      sendArtifactConversation(artifactId, input),
    onSuccess(session) {
      setDraft('')
      onClearTarget()
      queryClient.setQueryData(queryKey, { availability: 'busy', session })
      void queryClient.invalidateQueries({ queryKey })
    },
    onError() {
      void queryClient.invalidateQueries({ queryKey })
    },
  })
  const denied = status.error instanceof ApiError && [401, 403, 404].includes(status.error.status)
  const session = denied ? undefined : status.data?.session
  const availability = status.data?.availability
  const running = session?.turns.at(-1)?.status === 'running'
  const notice = running ? null : getConnectionNotice(artifactId, status.error, availability)
  const message = draft.trim()
  const canSend = !status.isError && availability === 'ready' && Boolean(message)

  const editMessage: ChangeEventHandler<HTMLTextAreaElement> = (event) =>
    setDraft(event.currentTarget.value)
  const submitMessage: FormEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault()
    if (!canSend || send.isPending) return
    send.mutate({ message, target: target?.reference })
  }

  return (
    <aside
      id="artifact-agent-conversation"
      aria-label="Agent 对话"
      hidden={!open}
      className="absolute inset-0 z-20 flex min-h-0 flex-col border-border bg-surface text-sm lg:static lg:w-92 lg:shrink-0 lg:border-e xl:w-104"
    >
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-border p-3">
        <h2 ref={heading} tabIndex={-1} className="font-semibold outline-hidden">
          Agent 对话
        </h2>
        <Button variant="ghost" size="sm" leftIcon={<ArrowLeft size={15} />} onClick={onClose}>
          返回画布
        </Button>
      </header>
      {notice && (
        <p className="shrink-0 px-3 pt-3 text-xs text-ink-muted" role="status">
          {notice.text}
          {notice.command && (
            <code dir="ltr" className="block select-all wrap-break-word">
              {notice.command}
            </code>
          )}
        </p>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {session?.turns.length ? <AgentTurnList turns={session.turns} /> : null}
      </div>
      <form className="shrink-0 space-y-2 border-t border-border p-3" onSubmit={submitMessage}>
        {target ? (
          <div className="flex items-start justify-between gap-2 rounded-md bg-surface-subtle px-2 py-1.5">
            <div className="min-w-0 wrap-break-word text-xs">
              <p className="font-medium">{target.label}</p>
              <p className="text-ink-muted">{describeAgentTarget(target.reference)}</p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              iconOnly
              aria-label="移除选区引用"
              onClick={onClearTarget}
              type="button"
            >
              <X size={14} />
            </Button>
          </div>
        ) : null}
        <Textarea
          aria-label="消息"
          rows={3}
          maxLength={8000}
          value={draft}
          disabled={send.isPending}
          onChange={editMessage}
        />
        {send.error ? (
          <p role="alert" className="text-xs">
            未发送：{send.error.message}
          </p>
        ) : null}
        <div className="flex justify-end">
          <Button
            type="submit"
            size="sm"
            leftIcon={<Send size={14} />}
            disabled={!canSend && !send.isPending}
            loading={send.isPending}
          >
            发送
          </Button>
        </div>
      </form>
    </aside>
  )
}
