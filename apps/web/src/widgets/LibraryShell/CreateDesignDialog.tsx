import type { AgentConnection, AgentConversation, Project } from '@akasha/protocol'
import { Button } from '@akasha/ui/button'
import { Modal } from '@akasha/ui/dialog'
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import { type ReactNode, useId, useState } from 'react'
import { artifactKeys } from '../../entities/artifact/queries'
import { AgentTurnList } from '../../features/agent-conversation/AgentTurnList'
import { useAgentDraft } from '../../features/agent-conversation/agent-draft'
import {
  ApiError,
  fetchAgentConnections,
  fetchAgentDesignSession,
  startAgentDesign,
} from '../../shared/api/client'

interface DesignAttempt {
  /** 实际受理之后才有的本机会话。 */
  id: string
  /** 原请求授权的项目，不跟随库的筛选器。 */
  projectId: string
}

const attemptKey = 'akasha:agent-design-attempt'
const uuid = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i

function readAttempt(): DesignAttempt | null {
  try {
    const raw = sessionStorage.getItem(attemptKey)
    if (!raw) return null
    const value = JSON.parse(raw) as Partial<DesignAttempt> | null
    return value &&
      typeof value.id === 'string' &&
      uuid.test(value.id) &&
      typeof value.projectId === 'string' &&
      value.projectId
      ? { id: value.id, projectId: value.projectId }
      : null
  } catch {
    return null
  }
}

function writeAttempt(value: DesignAttempt | null) {
  try {
    if (value) sessionStorage.setItem(attemptKey, JSON.stringify(value))
    else sessionStorage.removeItem(attemptKey)
  } catch {}
}

interface CreateDesignProps {
  projects: readonly Project[]
  open: boolean
  hub: boolean
  onClose: () => void
  onOpenArtifact: (publicId: string) => void
}

function getConnectionNotice(
  hub: boolean,
  { error, status }: Pick<UseQueryResult, 'error' | 'status'>,
  hasProjects: boolean,
  project: Project | undefined,
  connection: AgentConnection | undefined,
): { text: string; command?: string } | null {
  if (hub) return { text: '在本机创建设计', command: 'akasha open' }
  if (error instanceof ApiError && error.status === 401) {
    return { text: '登录本机制品库', command: 'akasha open' }
  }
  if (status === 'error') return { text: '无法读取 Agent 连接' }
  if (status === 'pending') return { text: '正在检查连接…' }
  if (!project && hasProjects) return null
  if (!connection) {
    return { text: '在项目目录连接 Codex', command: 'akasha agent connect --project .' }
  }
  if (connection.availability === 'busy') return { text: 'Codex 正忙' }
  return null
}

/** 只有同一受理会话的真实 v1 发布记录才允许打开制品；未发布时保留用户需求。 */
export function CreateDesignDialog({
  projects,
  open,
  hub,
  onClose,
  onOpenArtifact,
}: CreateDesignProps) {
  const formId = useId()
  const cache = useQueryClient()
  const [attempt, setAttempt] = useState(() => (hub ? null : readAttempt()))
  const [projectId, setProjectId] = useState(attempt?.projectId ?? '')
  const [agent, setAgent] = useState<'codex' | ''>(attempt ? 'codex' : '')
  const [message, setMessage] = useAgentDraft('new-design')
  const connections = useQuery({
    queryKey: ['agent-connections'],
    queryFn: ({ signal }) => fetchAgentConnections(signal),
    enabled: open && !hub,
    retry: false,
    refetchInterval: 4000,
  })
  const sessionQuery = useQuery({
    queryKey: ['agent-design-session', attempt?.id],
    queryFn: ({ signal }) => {
      if (!attempt) throw new Error('没有已受理的设计会话')
      return fetchAgentDesignSession(attempt.id, signal)
    },
    enabled: open && Boolean(attempt) && !hub,
    retry: false,
    refetchInterval: (query) =>
      query.state.data?.turns.at(-1)?.status === 'running' ? 1000 : false,
  })
  const send = useMutation({
    mutationFn: (input: { projectId: string; message: string }) =>
      startAgentDesign(input.projectId, input.message),
    onSuccess(session: AgentConversation) {
      const next = { id: session.id, projectId: session.projectId }
      cache.setQueryData(['agent-design-session', session.id], session)
      setAttempt(next)
      writeAttempt(next)
      void cache.invalidateQueries({ queryKey: ['agent-connections'] })
    },
    onError() {
      void cache.invalidateQueries({ queryKey: ['agent-connections'] })
    },
  })
  const project = projects.find((entry) => entry.id === projectId)
  const connection = connections.data?.connections.find((entry) => entry.projectId === projectId)
  const denied =
    sessionQuery.error instanceof ApiError && [401, 403, 404].includes(sessionQuery.error.status)
  const missing = sessionQuery.error instanceof ApiError && sessionQuery.error.status === 404
  const session = denied || hub ? undefined : sessionQuery.data
  const turn = session?.turns[0]
  // 服务端只在确认真实 v1 后写 artifactId；会话的最近轮次可以滚动淘汰首次回执。
  const published =
    session?.projectId === attempt?.projectId && session?.id === attempt?.id
      ? session?.artifactId
      : undefined
  const locked = Boolean(attempt) || send.isPending
  const canSend =
    !hub &&
    !locked &&
    !!project &&
    !connections.isError &&
    agent === 'codex' &&
    connection?.availability === 'ready' &&
    !!message.trim()
  const notice = getConnectionNotice(hub, connections, projects.length > 0, project, connection)

  const clearAttempt = () => {
    setAttempt(null)
    setAgent('')
    writeAttempt(null)
  }

  const openPublished = () => {
    if (!published) return
    if (message.trim() === turn?.message) setMessage('')
    clearAttempt()
    void cache.invalidateQueries({ queryKey: artifactKeys.lists })
    onOpenArtifact(published)
  }

  let primaryAction: ReactNode
  if (published) {
    primaryAction = <Button onClick={openPublished}>打开设计</Button>
  } else if (turn && turn.status !== 'running') {
    primaryAction = (
      <Button variant="outline" onClick={clearAttempt}>
        返回编辑
      </Button>
    )
  } else {
    primaryAction = (
      <Button
        type="submit"
        form={formId}
        disabled={!canSend && !send.isPending}
        loading={send.isPending}
      >
        发送设计需求
      </Button>
    )
  }

  return (
    <Modal
      open={open}
      onOpenChange={(visible) => {
        if (!visible) onClose()
      }}
      title="新建设计"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            关闭
          </Button>
          {primaryAction}
        </>
      }
    >
      <form
        id={formId}
        className="space-y-3 text-sm"
        onSubmit={(event) => {
          event.preventDefault()
          if (canSend) send.mutate({ projectId, message: message.trim() })
        }}
      >
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="space-y-1">
            <span className="block font-medium">项目</span>
            <select
              value={projectId}
              disabled={locked || hub}
              className="w-full rounded-md border border-border bg-surface px-2 py-1.5"
              onChange={(event) => {
                setProjectId(event.target.value)
                setAgent('')
                send.reset()
              }}
            >
              <option value="">选择项目</option>
              {projects.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="block font-medium">发布 Agent</span>
            <select
              value={agent}
              disabled={locked || hub || connection?.availability !== 'ready'}
              className="w-full rounded-md border border-border bg-surface px-2 py-1.5"
              onChange={(event) => setAgent(event.target.value === 'codex' ? 'codex' : '')}
            >
              <option value="">选择 Agent</option>
              {connection || attempt ? <option value="codex">本机 Codex</option> : null}
            </select>
          </label>
        </div>
        {notice && (
          <p className="text-xs leading-5 text-ink-muted" role="status">
            {notice.text}
            {notice.command && <code className="block select-all text-ink">{notice.command}</code>}
          </p>
        )}
        <label className="block space-y-1 font-medium">
          <span>设计需求</span>
          <textarea
            rows={4}
            className="block w-full resize-y rounded-md border border-border bg-canvas px-2 py-2 font-normal outline-primary"
            maxLength={8000}
            value={message}
            disabled={send.isPending}
            onChange={(event) => setMessage(event.target.value)}
          />
        </label>
        {send.error && <p role="alert">提交失败：{send.error.message}</p>}
        {sessionQuery.isError ? (
          <div role="alert" className="flex flex-wrap items-center gap-2">
            <span>{missing ? '会话已失效' : '无法读取会话'}</span>
            {missing ? (
              <Button variant="outline" size="sm" onClick={clearAttempt}>
                返回编辑
              </Button>
            ) : (
              <Button variant="ghost" size="sm" onClick={() => void sessionQuery.refetch()}>
                重试
              </Button>
            )}
          </div>
        ) : null}
        {attempt && !session && !sessionQuery.isError ? <p role="status">正在读取会话…</p> : null}
        {turn ? (
          <div className="max-h-56 space-y-2 overflow-y-auto border-t border-border pt-2">
            <AgentTurnList turns={session?.turns ?? []} />
          </div>
        ) : null}
      </form>
    </Modal>
  )
}
