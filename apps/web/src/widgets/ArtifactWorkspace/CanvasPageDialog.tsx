import type { Artifact, Version, VersionSummary } from '@akasha/protocol'
import { Button } from '@akasha/ui/button'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@akasha/ui/dialog'
import { Field } from '@akasha/ui/field'
import { Input } from '@akasha/ui/input'
import { useQueryClient } from '@tanstack/react-query'
import { type FormEventHandler, useId, useRef, useState } from 'react'
import {
  artifactKeys,
  artifactSourceOptions,
  type CanvasPage,
  hasVersionSource,
  publishHumanVersion,
} from '@/entities/artifact'
import { useMessages } from '@/shared/i18n'
import { useBoardEditError } from './board-edit-error-messages'
import { navigationMessages } from './board-navigation-messages'
import { type CanvasPageEdit, editCanvasPages } from './canvas-page-source'

/** 可保存页面的头版本快照。 */
export interface CanvasPageEditing {
  artifact: Artifact
  version: VersionSummary
  onVersionSaved?: (version: Version) => void
}

/** 打开操作时固定目标与基准版本；切页或收到新版都不会重定向写入。 */
export type PageActionRequest =
  | { kind: 'create'; baseVersion: number }
  | { kind: 'rename' | 'delete'; page: CanvasPage; baseVersion: number }

interface CanvasPageDialogProps {
  editing: CanvasPageEditing
  request: PageActionRequest
  currentPageId?: string
  pages: readonly CanvasPage[]
  onNavigate: (page: CanvasPage) => void
  onClose: (saved?: PageActionRequest['kind']) => void
  restoreFocus: () => void
}

function toPageEdit(request: PageActionRequest, title: string): CanvasPageEdit {
  if (request.kind === 'create') return { kind: 'create', id: crypto.randomUUID(), title }
  if (request.kind === 'rename') return { kind: 'rename', id: request.page.id, title }
  return { kind: 'delete', id: request.page.id }
}

/** 只保存已确认的页面变更；基准版本过期时保留输入并给出错误。 */
export function CanvasPageDialog({
  editing,
  request,
  currentPageId,
  pages,
  onNavigate,
  onClose,
  restoreFocus,
}: CanvasPageDialogProps) {
  const { t } = useMessages(navigationMessages)
  const queryClient = useQueryClient()
  const formId = useId()
  const cancelRef = useRef<HTMLButtonElement>(null)
  const [name, setName] = useState(request.kind === 'rename' ? request.page.title : '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const errorText = useBoardEditError(error)
  const { artifact, version, onVersionSaved } = editing
  const title = name.trim()
  const canSave =
    request.kind === 'delete' ||
    (Boolean(title) && (request.kind !== 'rename' || title !== request.page.title))

  const save: FormEventHandler<HTMLFormElement> = async (event) => {
    event.preventDefault()
    if (saving || !canSave) return
    setError('')
    setSaving(true)
    try {
      if (request.baseVersion !== version.version) {
        throw new Error('作品已更新，请重新操作')
      }
      const edit = toPageEdit(request, title)
      const base = hasVersionSource(version)
        ? version
        : await queryClient.fetchQuery(
            artifactSourceOptions(artifact.publicId, request.baseVersion),
          )
      const source = editCanvasPages(base.source, request.baseVersion, edit)
      const saved = await publishHumanVersion({
        project: artifact.projectId,
        slug: artifact.slug,
        title: version.title,
        type: artifact.type,
        baseVersion: request.baseVersion,
        source,
      })
      queryClient.setQueryData(
        artifactKeys.source(artifact.publicId, saved.version.version),
        saved.version,
      )
      void queryClient.invalidateQueries({ queryKey: artifactKeys.all })
      onVersionSaved?.(saved.version)
      onClose(edit.kind)
      if (edit.kind === 'create') {
        onNavigate({ id: edit.id, title: edit.title, boards: [] })
      } else if (edit.kind === 'delete' && edit.id === currentPageId) {
        const fallback = pages.find((entry) => entry.id !== edit.id)
        onNavigate(fallback ?? { id: '', title: '总览', boards: [] })
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法保存页面')
    } finally {
      setSaving(false)
    }
  }

  const changeOpen = (open: boolean) => {
    if (!open && !saving) onClose()
  }
  const focusCancelOnDelete = (event: Event) => {
    if (request.kind !== 'delete') return
    event.preventDefault()
    cancelRef.current?.focus()
  }
  const returnDialogFocus = (event: Event) => {
    event.preventDefault()
    restoreFocus()
  }
  const action = ({ create: '新建页面', rename: '重命名页面', delete: '删除页面' } as const)[
    request.kind
  ]

  return (
    <Dialog open onOpenChange={changeOpen}>
      <DialogContent
        size="sm"
        entrance="settle"
        aria-describedby={undefined}
        onOpenAutoFocus={focusCancelOnDelete}
        onCloseAutoFocus={returnDialogFocus}
      >
        <DialogHeader>
          <DialogTitle>{t(action)}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <form id={formId} onSubmit={save}>
            {request.kind === 'delete' ? (
              <p className="break-words text-sm text-ink">
                {t('删除「{title}」及其 {count} 张直属画板？共享画板和旧版本不变。', {
                  title: request.page.title,
                  count: request.page.ownedBoardCount ?? 0,
                })}
              </p>
            ) : (
              <Field label={t('页面名称')} error={errorText}>
                <Input
                  value={name}
                  readOnly={saving}
                  onChange={(event) => setName(event.target.value)}
                />
              </Field>
            )}
            {request.kind === 'delete' && error ? <p role="alert">{errorText}</p> : null}
          </form>
        </DialogBody>
        <DialogFooter>
          <Button ref={cancelRef} variant="ghost" disabled={saving} onClick={() => onClose()}>
            {t('取消')}
          </Button>
          <Button
            type="submit"
            form={formId}
            variant={request.kind === 'delete' ? 'destructive' : 'primary'}
            disabled={!canSave}
            loading={saving}
          >
            {t(request.kind === 'delete' ? '删除' : '保存')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
