import type { CodingWorkspace } from '@akasha/protocol'
import { Button } from '@akasha/ui/button'
import { Field } from '@akasha/ui/field'
import { Textarea } from '@akasha/ui/textarea'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { ApiError, getRequestErrorMessage } from '@/shared/api/error'
import { isCloudHub } from '@/shared/config/runtime'
import { useMessages } from '@/shared/i18n'
import { publishCodingWorkspace, readCodingWorkspace } from '../api/coding-sessions'
import { messages } from '../messages'

function WorkspaceEditor({ workspace }: { workspace: CodingWorkspace }) {
  const { t } = useMessages(messages)
  const { target, snapshot } = workspace
  const { reference, design, components } = snapshot
  const [draft, setDraft] = useState(design.source)
  const save = useMutation({
    mutationFn: (source: string) => publishCodingWorkspace(reference.projectId, target.id, source),
  })
  const published = save.data ?? workspace.publication
  const query = isCloudHub() ? '?shared=1' : ''
  const locator = new URLSearchParams()
  if (reference.pageId !== undefined) locator.set('page', reference.pageId)
  if (reference.boardId) locator.set('board', reference.boardId)
  const fixedPath = `/a/${encodeURIComponent(reference.artifactId)}/v/${reference.version}${query}#${locator}`
  return (
    <main className="mx-auto grid max-w-4xl gap-4 p-4 md:p-8">
      <header>
        <p className="text-sm text-ink-muted">
          {t('编码工作区')} · <bdi>{target.label}</bdi>
        </p>
        <h1 className="text-xl font-semibold">
          <bdi>{design.title}</bdi>
        </h1>
        <a href={fixedPath} className="underline">
          {t('基于 v{version}', { version: reference.version })}
        </a>
      </header>
      {design.selection && (
        <details open>
          <summary className="cursor-pointer">{t('固定选区')}</summary>
          <pre dir="ltr" className="overflow-auto whitespace-pre-wrap break-all text-sm">
            {JSON.stringify(design.selection, null, 2)}
          </pre>
        </details>
      )}
      {components.map((component) => (
        <details key={`${component.path}#${component.exportName}`}>
          <summary className="cursor-pointer font-mono">
            <bdi>
              {component.path}#{component.exportName}
            </bdi>
          </summary>
          <pre dir="ltr" className="max-h-80 overflow-auto text-sm">
            {component.source}
          </pre>
        </details>
      ))}
      <Field label={t('作品源码')}>
        <Textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          readOnly={!!published || save.isPending}
          rows={16}
          dir="ltr"
          spellCheck={false}
          className="font-mono"
        />
      </Field>
      {save.error && <p role="alert">{getRequestErrorMessage(save.error)}</p>}
      <div>
        {published ? (
          <a className="underline" href={`${published.path}${query}`}>
            {t('打开 v{version}', { version: published.version })}
          </a>
        ) : (
          <Button
            loading={save.isPending}
            disabled={!draft.trim() || draft === design.source}
            onClick={() => save.mutate(draft)}
          >
            {t('发布新版本')}
          </Button>
        )}
      </div>
    </main>
  )
}

/** 固定会话书签不包含凭据；恢复时重新检查作者权限，不从作品头版初始化编辑器。 */
export function CodingWorkspacePage({
  projectId,
  sessionId,
}: {
  projectId: string
  sessionId: string
}) {
  const { t } = useMessages(messages)
  const workspace = useQuery({
    queryKey: ['coding-workspace', projectId, sessionId],
    queryFn: ({ signal }) => readCodingWorkspace(projectId, sessionId, signal),
    gcTime: 0,
    retry: false,
  })
  if (workspace.isError)
    return (
      <main className="space-y-3 p-6">
        <h1>{t('编码工作区')}</h1>
        <p role="alert">{getRequestErrorMessage(workspace.error)}</p>
        {isCloudHub() && workspace.error instanceof ApiError && workspace.error.status === 401 && (
          <a
            className="underline"
            href={`/auth/login?next=${encodeURIComponent(window.location.pathname)}`}
          >
            {t('登录')}
          </a>
        )}
        <Button onClick={() => void workspace.refetch()}>{t('重新加载')}</Button>
      </main>
    )
  if (workspace.isPending)
    return (
      <main role="status" className="p-6">
        {t('加载中')}
      </main>
    )
  return <WorkspaceEditor workspace={workspace.data} />
}
