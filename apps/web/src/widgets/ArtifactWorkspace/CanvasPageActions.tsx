import type { Artifact, Version } from '@akasha/protocol'
import { Button } from '@akasha/ui/button'
import { Input } from '@akasha/ui/input'
import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { artifactKeys } from '../../entities/artifact/queries'
import { type ArtifactDetailResponse, publishHumanVersion } from '../../shared/api/client'
import { addCanvasPage, type CanvasPage } from './canvas-model'

/** 可保存页面的头版本快照。 */
export interface CanvasPageEditing {
  artifact: Artifact
  version: Version
  onVersionSaved?: (version: Version) => void
}

interface CanvasPageActionsProps {
  editing: CanvasPageEditing
  onNavigate: (page: CanvasPage) => void
}

/** 只保存已确认的页面变更；基准版本过期时保留输入并给出错误。 */
export function CanvasPageActions({ editing, onNavigate }: CanvasPageActionsProps) {
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState<{ title: string; baseVersion: number } | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const { artifact, version, onVersionSaved } = editing

  async function save() {
    if (!draft || saving) return
    const title = draft.title.trim()
    if (!title) return
    setError('')
    setSaving(true)
    try {
      if (draft.baseVersion !== version.version) {
        throw new Error('制品已更新，请重新开始页面操作')
      }
      const page = { id: crypto.randomUUID(), title, boards: [] }
      const source = addCanvasPage(version.source, page)
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
      onNavigate(page)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法保存画布页面')
    } finally {
      setSaving(false)
    }
  }

  if (!draft) {
    return (
      <Button
        size="sm"
        variant="ghost"
        onClick={() => {
          setError('')
          setDraft({ title: '', baseVersion: version.version })
        }}
      >
        新建页面
      </Button>
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
      <Input
        aria-label="页面名称"
        placeholder="页面名称"
        controlSize="sm"
        value={draft.title}
        disabled={saving}
        onChange={(event) => setDraft({ ...draft, title: event.target.value })}
      />
      {error ? (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" disabled={saving} onClick={() => setDraft(null)}>
          取消
        </Button>
        <Button type="submit" size="sm" disabled={!draft.title.trim() || saving}>
          {saving ? '保存中…' : '保存页面'}
        </Button>
      </div>
    </form>
  )
}
