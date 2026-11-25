import type { AgentConnection, AgentConversation, Project } from '@akasha/protocol'
import { Button } from '@akasha/ui/button'
import { Modal } from '@akasha/ui/dialog'
import { Field } from '@akasha/ui/field'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@akasha/ui/select'
import { Textarea } from '@akasha/ui/textarea'
import { type UseQueryResult, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { type ChangeEventHandler, useEffect, useId, useState } from 'react'
import { artifactKeys } from '@/entities/artifact'
import {
  AgentTurnList,
  fetchAgentDesignSession,
  startAgentDesign,
  useAgentDraft,
} from '@/features/agent-conversation'
import { ApiError, getRequestErrorMessage } from '@/shared/api/error'
import { useMessages } from '@/shared/i18n'
import { messages } from './messages'
import { useDesignConnections } from './useDesignConnections'

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
  onClose: () => void
  onOpenArtifact: (publicId: string) => void
  onResumableChange?: (resumable: boolean) => void
}

function getConnectionNotice(
  { error, status }: Pick<UseQueryResult, 'error' | 'status'>,
  hasProjects: boolean,
  project: Project | undefined,
  connection: AgentConnection | undefined,
): { text: keyof typeof messages; command?: string } | null {
  if (error instanceof ApiError && error.status === 401) {
    return { text: '登录本机作品库', command: 'akasha open' }
  }
  if (error instanceof ApiError && error.status === 403) return { text: '无权新建设计' }
  if (status === 'error') return { text: '无法读取 Agent 连接' }
  if (status === 'pending') return null
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
  onClose,
  onOpenArtifact,
  onResumableChange,
}: CreateDesignProps) {
  const { t } = useMessages(messages)
  const formId = useId()
  const cache = useQueryClient()
  const [attempt, setAttempt] = useState(readAttempt)
  const [projectId, setProjectId] = useState(attempt?.projectId ?? '')
  const [agent, setAgent] = useState<'codex' | ''>(attempt ? 'codex' : '')
  const [message, setMessage] = useAgentDraft('new-design')
  const connections = useDesignConnections(open)
  const sessionQuery = useQuery({
    queryKey: ['agent-design-session', attempt?.id],
    queryFn: ({ signal }) => {
      if (!attempt) throw new Error(t('没有已受理的设计会话'))
      return fetchAgentDesignSession(attempt.id, signal)
    },
    enabled: open && Boolean(attempt),
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
  const connection = connections.isSuccess
    ? connections.data.connections.find((entry) => entry.projectId === projectId)
    : undefined
  const accessDenied =
    connections.error instanceof ApiError && [401, 403].includes(connections.error.status)
  const denied =
    accessDenied ||
    (sessionQuery.error instanceof ApiError && [401, 403, 404].includes(sessionQuery.error.status))
  const missing = sessionQuery.error instanceof ApiError && sessionQuery.error.status === 404
  const session = denied ? undefined : sessionQuery.data
  const turn = session?.turns[0]
  // 服务端只在确认真实 v1 后写 artifactId；会话的最近轮次可以滚动淘汰首次回执。
  const published =
    session?.projectId === attempt?.projectId && session?.id === attempt?.id
      ? session?.artifactId
      : undefined
  const locked = Boolean(attempt) || send.isPending
  useEffect(() => {
    onResumableChange?.(locked)
  }, [locked, onResumableChange])
  const canSend =
    !locked &&
    !!project &&
    connections.isSuccess &&
    agent === 'codex' &&
    connection?.availability === 'ready' &&
    !!message.trim()
  const notice = getConnectionNotice(connections, projects.length > 0, project, connection)

  const selectProject = (id: string) => {
    setProjectId(id)
    setAgent('')
    send.reset()
  }

  const selectAgent = (value: string) => setAgent(value === 'codex' ? 'codex' : '')
  const editBrief: ChangeEventHandler<HTMLTextAreaElement> = (event) =>
    setMessage(event.currentTarget.value)

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

  const canReturnToBrief = !published && turn !== undefined && turn.status !== 'running'

  return (
    <Modal
      open={open}
      onOpenChange={(visible) => {
        if (!visible) onClose()
      }}
      title={t('新建设计')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('关闭')}
          </Button>
          {published && <Button onClick={openPublished}>{t('打开设计')}</Button>}
          {canReturnToBrief && (
            <Button variant="outline" onClick={clearAttempt}>
              {t('返回编辑')}
            </Button>
          )}
          {!accessDenied && !published && !canReturnToBrief && (
            <Button
              type="submit"
              form={formId}
              disabled={!canSend && !send.isPending}
              loading={send.isPending}
            >
              {t('发送')}
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
          <Field label={t('项目')}>
            <Select value={projectId} disabled={locked} onValueChange={selectProject}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder={t('选择项目')} />
              </SelectTrigger>
              <SelectContent empty={t('无项目')}>
                {projects.map((entry) => (
                  <SelectItem key={entry.id} value={entry.id}>
                    {entry.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label={t('发布 Agent')}>
            <Select
              value={agent}
              disabled={locked || connection?.availability !== 'ready'}
              loading={connections.isPending}
              onValueChange={selectAgent}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder={t('选择 Agent')} />
              </SelectTrigger>
              <SelectContent>
                {(connection || attempt) && (
                  <SelectItem value="codex">{t('本机 Codex')}</SelectItem>
                )}
              </SelectContent>
            </Select>
          </Field>
        </div>
        {notice && (
          <p className="text-xs leading-5 text-ink-muted" role="status">
            {t(notice.text)}
            {notice.command && (
              <code dir="ltr" className="block select-all text-ink">
                {notice.command}
              </code>
            )}
          </p>
        )}
        <Field label={t('设计需求')}>
          <Textarea
            rows={4}
            maxLength={8000}
            value={message}
            dir="auto"
            disabled={send.isPending}
            onChange={editBrief}
          />
        </Field>
        {send.error && (
          <p role="alert">
            {t('提交失败：{reason}', { reason: getRequestErrorMessage(send.error) })}
          </p>
        )}
        {!accessDenied && sessionQuery.isError ? (
          <div role="alert" className="flex flex-wrap items-center gap-2">
            <span>{missing ? t('会话已失效') : t('无法读取会话')}</span>
            {missing ? (
              <Button variant="outline" size="sm" onClick={clearAttempt}>
                {t('返回编辑')}
              </Button>
            ) : (
              <Button variant="ghost" size="sm" onClick={() => void sessionQuery.refetch()}>
                {t('重试')}
              </Button>
            )}
          </div>
        ) : null}
        {attempt && !accessDenied && sessionQuery.isPending ? (
          <p role="status">{t('正在读取会话…')}</p>
        ) : null}
        {turn ? (
          <div className="max-h-56 space-y-2 overflow-y-auto border-t border-border pt-2">
            <AgentTurnList turns={session?.turns ?? []} />
          </div>
        ) : null}
      </form>
    </Modal>
  )
}
