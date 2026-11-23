import type { ArtifactHandoffReference } from '@akasha/protocol'
import { Button } from '@akasha/ui/button'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Send, X } from 'lucide-react'
import { useId } from 'react'
import {
  ApiError,
  fetchArtifactConversation,
  sendArtifactConversation,
} from '../../shared/api/client'
import { AgentTurnList, describeAgentTarget } from './AgentTurnList'
import { useAgentDraft } from './agent-draft'

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
  hub: boolean
  target?: ConversationTarget
  onClearTarget: () => void
  onClose: () => void
}

/** 非模态并列区域：不可用与回复是不同状态；窄屏仍保留画布原来的尺寸与实例。 */
export function AgentConversationPane({
  artifactId,
  projectId,
  open,
  hub,
  target,
  onClearTarget,
  onClose,
}: PaneProps) {
  const inputId = useId()
  const [draft, setDraft] = useAgentDraft(`artifact:${projectId}/${artifactId}`)
  const queryClient = useQueryClient()
  const queryKey = ['artifact-agent-session', artifactId] as const
  const status = useQuery({
    queryKey,
    queryFn: ({ signal }) => fetchArtifactConversation(artifactId, signal),
    enabled: open && !hub,
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
  const session = denied || hub ? undefined : status.data?.session
  const availability = status.data?.availability
  const canSend = !hub && !status.isError && availability === 'ready'
  const notice = hub
    ? '自托管 Hub 不会驱动本机 CLI。请在有该制品的 Local Daemon 中打开后续接。'
    : status.error instanceof ApiError && status.error.status === 401
      ? `请在终端运行 akasha open ${artifactId} 登录本机 Daemon。草稿会保留。`
      : status.isError
        ? '暂时无法读取本机 Agent 会话；未发送的草稿会保留。'
        : availability === 'unbound'
          ? '该制品没有通过本机受管 Codex 发布，不能续接其他线程。'
          : availability === 'offline'
            ? 'Codex 离线。在项目目录运行 akasha agent connect --project . 可重新授权。'
            : availability === 'busy'
              ? '项目中已有 CLI 轮次执行中。此处不排队发送。'
              : availability === 'ready'
                ? '已连接这份制品的发布会话。'
                : '正在查询本机发布会话…'

  return (
    <aside
      id="artifact-agent-conversation"
      aria-label="Agent 对话"
      className={
        open
          ? 'absolute inset-0 z-20 flex min-h-0 flex-col border-border bg-surface text-sm lg:static lg:w-[23rem] lg:shrink-0 lg:border-l xl:w-[26rem]'
          : 'hidden'
      }
    >
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-border p-3">
        <div>
          <h2 className="font-semibold">Agent 对话</h2>
          <p className="text-xs text-ink-muted">{session ? '本机 Codex · 发布会话' : '发布会话'}</p>
        </div>
        <Button variant="ghost" size="sm" leftIcon={<ArrowLeft size={15} />} onClick={onClose}>
          返回画布
        </Button>
      </header>
      <p
        className="shrink-0 border-b border-border px-3 py-2 text-xs leading-5 text-ink-muted"
        role="status"
      >
        {notice}
      </p>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {session?.turns.length ? <AgentTurnList turns={session.turns} /> : null}
      </div>
      <form
        className="shrink-0 space-y-2 border-t border-border p-3"
        onSubmit={(event) => {
          event.preventDefault()
          if (canSend && draft.trim() && !send.isPending)
            send.mutate({ message: draft.trim(), target: target?.reference })
        }}
      >
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
        <label htmlFor={inputId} className="block text-xs font-medium">
          给发布 Agent 的消息
        </label>
        <textarea
          id={inputId}
          className="w-full resize-y rounded-md border border-border bg-canvas px-2 py-2 outline-primary"
          rows={3}
          maxLength={8000}
          value={draft}
          disabled={send.isPending}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="例如：把这个对象的标题缩短一些"
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
            disabled={!canSend || !draft.trim() || send.isPending}
          >
            {send.isPending ? '正在交付…' : '发送给 Codex'}
          </Button>
        </div>
      </form>
    </aside>
  )
}
