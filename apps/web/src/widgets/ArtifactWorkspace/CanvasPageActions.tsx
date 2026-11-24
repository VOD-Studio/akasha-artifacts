import type { Artifact, Version } from '@akasha/protocol'
import { Button } from '@akasha/ui/button'
import { Field } from '@akasha/ui/field'
import { Input } from '@akasha/ui/input'
import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import {
  type ArtifactDetailResponse,
  artifactKeys,
  type CanvasPage,
  publishHumanVersion,
} from '../../entities/artifact'
import { type CanvasPageEdit, editCanvasPages } from './canvas-page-source'

/** 可保存页面的头版本快照。 */
export interface CanvasPageEditing {
  artifact: Artifact
  version: Version
  onVersionSaved?: (version: Version) => void
}

interface CanvasPageActionsProps {
  editing: CanvasPageEditing
  page: CanvasPage | undefined
  pages: readonly CanvasPage[]
  onNavigate: (page: CanvasPage) => void
}

type PageDraft =
  | { kind: 'create'; title: string; baseVersion: number }
  | { kind: 'rename'; page: CanvasPage; title: string; baseVersion: number }
  | { kind: 'delete'; page: CanvasPage; baseVersion: number }

function toPageEdit(draft: PageDraft, title: string): CanvasPageEdit {
  if (draft.kind === 'create') return { kind: 'create', id: crypto.randomUUID(), title }
  if (draft.kind === 'rename') return { kind: 'rename', id: draft.page.id, title }
  return { kind: 'delete', id: draft.page.id }
}

/** 只保存已确认的页面变更；基准版本过期时保留输入并给出错误。 */
export function CanvasPageActions({ editing, page, pages, onNavigate }: CanvasPageActionsProps) {
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState<PageDraft | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const { artifact, version, onVersionSaved } = editing
  const title = draft && 'title' in draft ? draft.title.trim() : ''
  const canSave =
    draft?.kind === 'delete' ||
    (Boolean(title) && (draft?.kind !== 'rename' || title !== draft.page.title))

  const begin = (next: PageDraft) => {
    setError('')
    setDraft(next)
  }

  const save = async () => {
    if (!draft || saving || !canSave) return
    setError('')
    setSaving(true)
    try {
      if (draft.baseVersion !== version.version) {
        throw new Error('作品已更新，请重新操作')
      }
      const edit = toPageEdit(draft, title)
      const source = editCanvasPages(version.source, draft.baseVersion, edit)
      const saved = await publishHumanVersion({
        project: artifact.projectId,
        slug: artifact.slug,
        title: version.title,
        type: artifact.type,
        baseVersion: draft.baseVersion,
        source,
      })
      queryClient.setQueryData<ArtifactDetailResponse>(
        artifactKeys.detail(artifact.publicId),
        (previous) => {
          if (!previous || previous.version.version >= saved.version.version) return previous
          return { ...previous, artifact: saved.artifact, version: saved.version }
        },
      )
      void queryClient.invalidateQueries({ queryKey: artifactKeys.all })
      onVersionSaved?.(saved.version)
      setDraft(null)
      if (edit.kind === 'create') {
        onNavigate({ id: edit.id, title: edit.title, boards: [] })
      } else if (edit.kind === 'delete') {
        const fallback = pages.find((entry) => entry.id !== edit.id)
        onNavigate(fallback ?? { id: '', title: '总览', boards: [] })
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法保存页面')
    } finally {
      setSaving(false)
    }
  }

  if (!draft) {
    return (
      <>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => begin({ kind: 'create', title: '', baseVersion: version.version })}
        >
          新建页面
        </Button>
        {page?.ownedBoardCount !== undefined ? (
          <>
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                begin({ kind: 'rename', page, title: page.title, baseVersion: version.version })
              }
            >
              重命名页面
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => begin({ kind: 'delete', page, baseVersion: version.version })}
            >
              删除页面
            </Button>
          </>
        ) : null}
      </>
    )
  }

  return (
    <form
      className="space-y-2 px-2 py-2"
      onSubmit={(event) => {
        event.preventDefault()
        void save()
      }}
    >
      {draft.kind === 'delete' ? (
        <p className="text-sm text-ink">
          删除「{draft.page.title}」及其 {draft.page.ownedBoardCount}{' '}
          张直属画板？共享画板和旧版本不变。
        </p>
      ) : (
        <Field label="页面名称" controlSize="sm" error={error}>
          <Input
            controlSize="sm"
            value={draft.title}
            disabled={saving}
            onChange={(event) => setDraft({ ...draft, title: event.target.value })}
          />
        </Field>
      )}
      {draft.kind === 'delete' && error ? (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" disabled={saving} onClick={() => setDraft(null)}>
          取消
        </Button>
        <Button type="submit" size="sm" disabled={!canSave} loading={saving}>
          {draft.kind === 'delete' ? '删除' : '保存'}
        </Button>
      </div>
    </form>
  )
}
