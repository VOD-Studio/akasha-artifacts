import {
  type ArtboardTweakValues,
  type Artifact,
  applyArtboardTweakApplication,
  listArtboardTweakTargets,
  type Version,
  type VersionSummary,
} from '@akasha/protocol'
import { Button } from '@akasha/ui/button'
import { Checkbox } from '@akasha/ui/checkbox'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@akasha/ui/dialog'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useRef, useState } from 'react'
import { hasVersionSource, useArtifactSourceQuery } from '@/entities/artifact'
import { fetchArtifactConversation, sendArtifactConversation } from '@/features/agent-conversation'
import { getRequestErrorMessage } from '@/shared/api/error'
import { useMessages } from '@/shared/i18n'
import { tweakApplyMessages } from './board-tweak-apply-messages'

interface BoardTweakApplyDialogProps {
  artifact: Artifact
  /** 打开时固定的头版本；不随后台刷新重定向。 */
  base: VersionSummary
  boardId: string
  values: ArtboardTweakValues
  agentAllowed: boolean
  /** true 只表示保存器已接手；发布结果由 onSaved 单独传回。 */
  onApply: (
    source: string,
    base: VersionSummary,
    onSaved: (saved: Version) => void,
  ) => Promise<boolean>
  onApplied: (saved: Version, titles: readonly string[]) => void
  onAgentAccepted: () => void
  onClose: () => void
}

/** 只在确认窗解析完整的固定快照；直接保存与交给已绑定会话共用同一范围。 */
export function BoardTweakApplyDialog({
  artifact,
  base,
  boardId,
  values,
  agentAllowed,
  onApply,
  onApplied,
  onAgentAccepted,
  onClose,
}: BoardTweakApplyDialogProps) {
  const { t } = useMessages(tweakApplyMessages)
  const sourceQuery = useArtifactSourceQuery(
    artifact.publicId,
    base.version,
    !hasVersionSource(base),
  )
  const snapshot = hasVersionSource(base) ? base : sourceQuery.data
  const readError = !hasVersionSource(base) && sourceQuery.isError
  const stale =
    artifact.headVersion !== base.version ||
    base.artifactId !== artifact.publicId ||
    (snapshot !== undefined &&
      (snapshot.version !== base.version || snapshot.artifactId !== base.artifactId))
  const source = !stale && !readError ? snapshot?.source : undefined
  const targets = useMemo(() => {
    if (source === undefined) return null
    try {
      return listArtboardTweakTargets(source, base.version, boardId, values)
    } catch {
      return null
    }
  }, [source, base.version, boardId, values])
  const client = useQueryClient()
  const sessionKey = ['artifact-agent-session', artifact.publicId] as const
  const status = useQuery({
    queryKey: sessionKey,
    queryFn: ({ signal }) => fetchArtifactConversation(artifact.publicId, signal),
    enabled: agentAllowed && !stale && !readError,
    retry: false,
  })
  const session = status.data?.session
  const bound =
    agentAllowed &&
    !status.isError &&
    !status.isFetching &&
    status.data?.availability === 'ready' &&
    session?.artifactId === artifact.publicId &&
    session.projectId === artifact.projectId &&
    session.turns.at(-1)?.status !== 'running'
  const [selected, setSelected] = useState(() => new Set([boardId]))
  const [pending, setPending] = useState<'agent' | 'publish' | null>(null)
  const lock = useRef(false)
  const [error, setError] = useState('')
  const chosen =
    targets?.filter((target) => target.status === 'changed' && selected.has(target.id)) ?? []
  const canSubmit =
    chosen.length > 0 && !pending && (hasVersionSource(base) || !sourceQuery.isFetching)
  const duplicateTitles = useMemo(() => {
    const seen = new Set<string>()
    const duplicates = new Set<string>()
    for (const target of targets ?? []) {
      if (seen.has(target.title)) duplicates.add(target.title)
      seen.add(target.title)
    }
    return duplicates
  }, [targets])
  const targetName = (board: { id: string; title: string }) =>
    duplicateTitles.has(board.title) ? `${board.title} (${board.id})` : board.title
  const changeSelection = (id: string, checked: boolean) => {
    setSelected((previous) => {
      const next = new Set(previous)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }
  const submit = async (mode: 'agent' | 'publish') => {
    if (!canSubmit || lock.current || source === undefined || (mode === 'agent' && !bound)) return
    lock.current = true
    setPending(mode)
    setError('')
    const application = { boardId, values, targetIds: chosen.map((board) => board.id) }
    try {
      if (mode === 'agent') {
        const accepted = await sendArtifactConversation(artifact.publicId, {
          target: {
            artifactId: artifact.publicId,
            projectId: artifact.projectId,
            version: base.version,
            boardId,
          },
          tweakApplication: application,
          message: t('请将 v{version} 的预览参数应用到所选画板，并发布一个新版本。', {
            version: base.version,
          }),
        })
        const turn = accepted.turns.at(-1)
        if (!turn || accepted.id !== session?.id || accepted.artifactId !== artifact.publicId)
          throw new Error(t('无法应用参数'))
        // 已受理的轮次可能在响应前结束；对话面板展示它的真实状态及发布回执。
        void client.invalidateQueries({ queryKey: sessionKey })
        onAgentAccepted()
        return
      }
      const result = applyArtboardTweakApplication(source, base.version, application)
      const titles = result.changed.map(targetName)
      if (await onApply(result.source, base, (saved) => onApplied(saved, titles))) {
        onClose()
        return
      }
      setError(t('无法应用参数'))
    } catch (cause) {
      setError(getRequestErrorMessage(cause, t('无法应用参数')))
    }
    lock.current = false
    setPending(null)
  }
  const changeOpen = (open: boolean) => {
    if (!open && !lock.current) onClose()
  }
  return (
    <Dialog open onOpenChange={changeOpen}>
      <DialogContent size="sm" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{t('应用参数')}</DialogTitle>
        </DialogHeader>
        <DialogBody className="space-y-3 text-sm">
          <p>{t('基准版本 v{version}', { version: base.version })}</p>
          {stale && (
            <p role="alert">
              {t('已基于 v{version} 打开，作品已更新。请重新选择。', { version: base.version })}
            </p>
          )}
          {!stale && readError && (
            <p role="alert">{getRequestErrorMessage(sourceQuery.error, t('无法读取画板'))}</p>
          )}
          {!stale && !readError && !snapshot && <p role="status">{t('正在读取画板')}</p>}
          {source !== undefined && !targets && <p role="alert">{t('无法读取画板')}</p>}
          {targets && (
            <fieldset className="space-y-2">
              <legend>{t('选择画板')}</legend>
              {targets.map((target) => (
                <label key={target.id} className="flex items-center gap-2">
                  <Checkbox
                    checked={target.status === 'changed' && selected.has(target.id)}
                    disabled={target.status !== 'changed' || Boolean(pending)}
                    onCheckedChange={(checked) => changeSelection(target.id, checked === true)}
                  />
                  <bdi className="wrap-anywhere">{target.title}</bdi>
                  {duplicateTitles.has(target.title) && (
                    <code dir="ltr" className="text-xs text-ink-muted">
                      {target.id}
                    </code>
                  )}
                  {target.status === 'incompatible' && <span>{t('不兼容')}</span>}
                  {target.status === 'unchanged' && <span>{t('无变化')}</span>}
                </label>
              ))}
            </fieldset>
          )}
          {agentAllowed && !status.isPending && !bound && !status.isFetching && (
            <p role="status">{t('当前没有可用的已绑定会话')}</p>
          )}
          {error && <p role="alert">{error}</p>}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" disabled={Boolean(pending)} onClick={onClose}>
            {t('取消')}
          </Button>
          {agentAllowed && (
            <Button
              disabled={!canSubmit || !bound}
              loading={pending === 'agent'}
              onClick={() => submit('agent')}
            >
              {t('请 Agent 应用')}
            </Button>
          )}
          <Button
            variant="primary"
            disabled={!canSubmit}
            loading={pending === 'publish'}
            onClick={() => submit('publish')}
          >
            {t('发布新版本')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
