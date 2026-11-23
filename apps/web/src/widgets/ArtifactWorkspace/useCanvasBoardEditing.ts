import type { Artifact, Version } from '@akasha/protocol'
import { useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { artifactKeys, notifyHumanVersionEdit } from '../../entities/artifact/queries'
import { ApiError, type ArtifactDetailResponse, publishHumanVersion } from '../../shared/api/client'
import {
  type CanvasBoardEdit,
  type CanvasSourceChange,
  editCanvasBoards,
} from './canvas-board-source'

interface EditingInput {
  artifact: Artifact
  version: Version
  enabled: boolean
  onVersionSaved?: (version: Version) => void
}

interface Timeline {
  past: readonly CanvasSourceChange[]
  future: readonly CanvasSourceChange[]
}

const EMPTY_TIMELINE: Timeline = { past: [], future: [] }
const MAX_LOCAL_EDITS = 24

interface PendingEdit {
  artifactId: string
  base: Version
  source: string
  timeline: Timeline
  status: 'saving' | 'failed'
  error?: string
}

/** 只有可写的头版本能开始新操作，失败的草稿须先由用户处理。 */
export interface CanvasBoardEditing {
  version: Version
  draft: PendingEdit | null
  inputError: string
  available: boolean
  change: (command: CanvasBoardEdit, base?: Version) => boolean
  /** 提交由服务端按基准源码预览得到的完整版本，也加入同一撤销历史。 */
  replaceSource: (source: string, base: Version) => boolean
  undo?: () => void
  redo?: () => void
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
  const [history, setHistory] = useState<{
    artifactId: string
    version: number
    timeline: Timeline
  } | null>(null)
  const [inputError, setInputError] = useState('')
  const inFlight = useRef(false)
  const draft = pending?.artifactId === artifact.publicId ? pending : null
  const available = enabled && !draft
  // 不跨作者或页面编辑发布的新头版本重放旧快照。
  const timeline =
    history?.artifactId === artifact.publicId && history.version === version.version
      ? history.timeline
      : EMPTY_TIMELINE

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
      await notifyHumanVersionEdit(artifact.projectId, saved.version, edit.base.source, 'canvas')
      query.setQueryData<ArtifactDetailResponse>(
        artifactKeys.detail(artifact.publicId),
        (current) =>
          !current || current.version.version >= saved.version.version
            ? current
            : { ...current, artifact: saved.artifact, version: saved.version },
      )
      setHistory({
        artifactId: artifact.publicId,
        version: saved.version.version,
        timeline: edit.timeline,
      })
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

  function replay(forward: boolean) {
    if (!available) return
    const change = (forward ? timeline.future : timeline.past).at(-1)
    if (!change) return
    void save({
      artifactId: artifact.publicId,
      base: version,
      source: forward ? change.after : change.before,
      timeline: forward
        ? { past: [...timeline.past, change], future: timeline.future.slice(0, -1) }
        : { past: timeline.past.slice(0, -1), future: [...timeline.future, change] },
      status: 'saving',
    })
  }

  function stage(change: CanvasSourceChange, base: Version): boolean {
    if (draft || inFlight.current) return false
    if (change.after === base.source) return true
    setInputError('')
    void save({
      artifactId: artifact.publicId,
      base,
      source: change.after,
      timeline: { past: [...timeline.past.slice(1 - MAX_LOCAL_EDITS), change], future: [] },
      status: 'saving',
    })
    return true
  }

  return {
    version,
    draft,
    inputError,
    available,
    undo: available && timeline.past.length ? () => replay(false) : undefined,
    redo: available && timeline.future.length ? () => replay(true) : undefined,
    change(command: CanvasBoardEdit, base = version) {
      if (draft || inFlight.current) return false
      setInputError('')
      try {
        return stage(editCanvasBoards(base.source, base.version, command), base)
      } catch (cause) {
        setInputError(cause instanceof Error ? cause.message : '无法应用画板操作')
        return false
      }
    },
    replaceSource(source, base) {
      return stage({ before: base.source, after: source }, base)
    },
    dismissDraft() {
      if (inFlight.current) return
      setPending(null)
      setInputError('')
    },
  }
}
