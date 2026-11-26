import type { AgentConnection, Project } from '@akasha/protocol'
import { Button } from '@akasha/ui/button'
import { Modal } from '@akasha/ui/dialog'
import { Field } from '@akasha/ui/field'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@akasha/ui/select'
import { Textarea } from '@akasha/ui/textarea'
import { type UseQueryResult, useQueryClient } from '@tanstack/react-query'
import { type ChangeEventHandler, useEffect, useId, useState } from 'react'
import { artifactKeys } from '@/entities/artifact'
import { ApiError, getRequestErrorMessage } from '@/shared/api/error'
import { useMessages } from '@/shared/i18n'
import { useAgentDraft } from '../model/agent-draft'
import { ReferenceComposer } from '../references/ReferenceComposer'
import { useReferenceDraft } from '../references/useReferenceDraft'
import { AgentTurnList } from '../ui/AgentTurnList'
import { messages } from './messages'
import { useDesignSession } from './useDesignSession'

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
  const {
    attempt,
    connections,
    send,
    sessionQuery,
    accessDenied,
    missing,
    session,
    turn,
    published,
    forgetAttempt,
  } = useDesignSession(open)
  const [projectId, setProjectId] = useState(attempt?.projectId ?? '')
  const [agent, setAgent] = useState<'codex' | ''>(attempt ? 'codex' : '')
  const [message, setMessage] = useAgentDraft('new-design')
  const project = projects.find((entry) => entry.id === projectId)
  const connection = connections.data?.connections.find((entry) => entry.projectId === projectId)
  const referenceProject = project && !accessDenied && connection ? project.id : ''
  const references = useReferenceDraft(referenceProject)
  const locked = Boolean(attempt) || send.isPending
  useEffect(() => {
    onResumableChange?.(locked)
  }, [locked, onResumableChange])
  const canSend =
    !locked &&
    !references.blocked &&
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
    forgetAttempt()
    setAgent('')
    references.invalidate()
  }

  const openPublished = () => {
    if (!published) return
    if (message.trim() === turn?.message) setMessage('')
    references.reset()
    forgetAttempt()
    setAgent('')
    void cache.invalidateQueries({ queryKey: artifactKeys.lists })
    onOpenArtifact(published)
  }

  const canReturnToBrief = !published && turn !== undefined && turn.status !== 'running'

  return (
    <Modal
      open={open}
      className="design-entry-dialog"
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
          const selection = references.selection
          if (!canSend || references.blocked || (references.entries.length && !selection)) return
          send.mutate(
            { projectId, message: message.trim(), references: selection },
            {
              onError: (error) => {
                if (error instanceof ApiError && error.status === 409) references.invalidate()
              },
            },
          )
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
        {referenceProject && agent === 'codex' && !attempt && (
          <ReferenceComposer key={referenceProject} draft={references} disabled={locked} />
        )}
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
