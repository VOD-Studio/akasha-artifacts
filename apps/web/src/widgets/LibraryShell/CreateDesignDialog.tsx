import type { AgentConversation, Project } from '@akasha/protocol'
import { Button } from '@akasha/ui/button'
import { Modal } from '@akasha/ui/dialog'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useId, useState } from 'react'
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
  const session = denied || hub ? undefined : sessionQuery.data
  const turn = session?.turns.at(-1)
  const published =
    session?.projectId === attempt?.projectId &&
    session?.id === attempt?.id &&
    session?.artifactId &&
    turn?.publications.some(
      ({ artifactId, version }) => artifactId === session.artifactId && version === 1,
    )
      ? session.artifactId
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
  const connectionHelp = hub
    ? '自托管 Hub 不会驱动本机 Agent。请在自己的项目目录接通 Codex，再用 akasha open 打开本机制品库。'
    : connections.error instanceof ApiError && connections.error.status === 401
      ? '请在项目目录运行 akasha open 登录本机制品库后再发送。'
      : connections.isError
        ? '暂时无法读取本机 Agent；草稿会保留。'
        : connections.isPending
          ? '正在查找已授权的 CLI…'
          : !project
            ? '先选择项目。还没有项目时，在对应目录运行下面的命令。'
            : !connection
              ? '该项目没有已连接的 Codex。'
              : connection.availability === 'busy'
                ? '该项目的 Codex 正在处理上一轮，不会离线排队。'
                : 'Codex 已接通，只处理当前所选项目。'

  function clearAttempt() {
    setAttempt(null)
    writeAttempt(null)
  }

  return (
    <Modal
      open={open}
      onOpenChange={(visible) => {
        if (!visible) onClose()
      }}
      title="新建设计"
      description="把需求交付给明确授权的本机 CLI。只有实际发布后，库里才出现可打开的制品。"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            关闭
          </Button>
          {published ? (
            <Button
              onClick={() => {
                if (message.trim() === turn?.message) setMessage('')
                clearAttempt()
                void cache.invalidateQueries({ queryKey: artifactKeys.lists })
                onOpenArtifact(published)
              }}
            >
              打开已发布设计
            </Button>
          ) : turn && turn.status !== 'running' ? (
            <Button variant="outline" onClick={clearAttempt}>
              保留草稿，返回编辑
            </Button>
          ) : (
            <Button type="submit" form={formId} disabled={!canSend}>
              {send.isPending ? '正在交付…' : '发送设计需求'}
            </Button>
          )}
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
              <option value="">{connection ? '选择 Agent' : '没有已连接的 Agent'}</option>
              {connection || attempt ? <option value="codex">本机 Codex</option> : null}
            </select>
          </label>
        </div>
        <div
          className="rounded-md bg-surface-subtle px-3 py-2 text-xs leading-5 text-ink-muted"
          role="status"
        >
          {connectionHelp}
          {!connection || hub ? (
            <code className="mt-1 block select-all text-ink">akasha agent connect --project .</code>
          ) : null}
        </div>
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
        {send.error ? <p role="alert">未受理：{send.error.message}。草稿已保留。</p> : null}
        {sessionQuery.isError ? (
          <div role="alert" className="flex flex-wrap items-center gap-2">
            <span>暂时查不到原会话；没有重新发送。</span>
            <Button variant="ghost" size="sm" onClick={() => void sessionQuery.refetch()}>
              重新查询
            </Button>
          </div>
        ) : null}
        {attempt && !session && !sessionQuery.isError ? (
          <p role="status">正在查询已受理的本机会话…</p>
        ) : null}
        {turn ? (
          <div className="max-h-56 space-y-2 overflow-y-auto border-t border-border pt-2">
            <p className="font-medium" role="status">
              {published
                ? '首版已发布'
                : turn.status === 'running'
                  ? '已交付本机 Codex，等待首次发布'
                  : turn.status === 'failed'
                    ? '已失败，未创建占位制品'
                    : '会话已结束，Agent 没有发布制品'}
            </p>
            <AgentTurnList turns={session?.turns ?? []} />
          </div>
        ) : null}
      </form>
    </Modal>
  )
}
