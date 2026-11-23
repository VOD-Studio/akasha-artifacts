import type { Artifact, Version } from '@akasha/protocol'
import { useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { artifactKeys } from '../../entities/artifact/queries'
import { ApiError, type ArtifactDetailResponse, publishHumanVersion } from '../../shared/api/client'
import { type CanvasBoardEdit, editCanvasBoards } from './canvas-board-source'

interface EditingInput {
  artifact: Artifact
  version: Version
  enabled: boolean
  onVersionSaved?: (version: Version) => void
}

interface PendingEdit {
  artifactId: string
  base: Version
  source: string
  status: 'saving' | 'failed'
  error?: string
}

/** 只有可写的头版本能开始新操作，失败的草稿须先由用户处理。 */
export interface CanvasBoardEditing {
  version: Version
  draft: PendingEdit | null
  inputError: string
  available: boolean
  change: (command: CanvasBoardEdit, base?: Version) => void
  dismissDraft: () => void
}

/** 画板编辑只发布当前制品的完整版本；失败的候选源码不会覆盖新的头版本。 */
export function useCanvasBoardEditing({
  artifact,
  version,
  enabled,
  onVersionSaved,
}: EditingInput): CanvasBoardEditing {
  const query = useQueryClient()
  const [pending, setPending] = useState<PendingEdit | null>(null)
  const [inputError, setInputError] = useState('')
  const inFlight = useRef(false)
  const draft = pending?.artifactId === artifact.publicId ? pending : null

  async function save(edit: PendingEdit) {
    if (inFlight.current) return
    if (
      !enabled ||
      version.version !== edit.base.version ||
      artifact.headVersion !== edit.base.version
    ) {
      setPending({ ...edit, status: 'failed', error: '头版本已更新，未保存的操作没有覆盖新版本。' })
      return
    }
    inFlight.current = true
    setPending({ ...edit, status: 'saving', error: undefined })
    try {
      const saved = await publishHumanVersion({
        project: artifact.projectId,
        slug: artifact.slug,
        title: edit.base.title,
        type: artifact.type,
        visibility: artifact.visibility,
        baseVersion: edit.base.version,
        source: edit.source,
      })
      query.setQueryData<ArtifactDetailResponse>(
        artifactKeys.detail(artifact.publicId),
        (current) =>
          !current || current.version.version >= saved.version.version
            ? current
            : { ...current, artifact: saved.artifact, version: saved.version },
      )
      setPending(null)
      void query.invalidateQueries({ queryKey: artifactKeys.all })
      onVersionSaved?.(saved.version)
    } catch (cause) {
      setPending({
        ...edit,
        status: 'failed',
        error: cause instanceof Error ? cause.message : '无法保存画板',
      })
      if (cause instanceof ApiError && cause.status === 409) {
        void query.invalidateQueries({ queryKey: artifactKeys.detail(artifact.publicId) })
      }
    } finally {
      inFlight.current = false
    }
  }

  return {
    version,
    draft,
    inputError,
    available: enabled && !draft,
    change(command: CanvasBoardEdit, base = version) {
      if (draft || inFlight.current) return
      setInputError('')
      try {
        const source = editCanvasBoards(base.source, base.version, command)
        if (source === base.source) return
        void save({ artifactId: artifact.publicId, base, source, status: 'saving' })
      } catch (cause) {
        setInputError(cause instanceof Error ? cause.message : '无法应用画板操作')
      }
    },
    dismissDraft() {
      if (inFlight.current) return
      setPending(null)
      setInputError('')
    },
  }
}
