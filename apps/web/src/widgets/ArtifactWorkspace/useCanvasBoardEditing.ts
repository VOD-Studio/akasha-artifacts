import {
  type Artifact,
  stabilizeArtboardSource,
  type Version,
  type VersionSummary,
} from '@akasha/protocol'
import { useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import {
  artifactKeys,
  artifactSourceOptions,
  hasVersionSource,
  publishHumanVersion,
} from '@/entities/artifact'
import { notifyHumanVersionEdit } from '@/entities/feedback'
import { ApiError } from '@/shared/api/error'
import {
  type CanvasBoardEdit,
  type CanvasSourceChange,
  editCanvasBoards,
} from './canvas-board-source'

interface EditingInput {
  artifact: Artifact
  version: VersionSummary
  enabled: boolean
  notifyAgent?: boolean
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
  version: VersionSummary
  draft: PendingEdit | null
  inputError: string
  available: boolean
  busy: boolean
  change: (command: CanvasBoardEdit, base?: VersionSummary) => Promise<boolean>
  /** 返回是否暂存；只有真实发布成功才调用 `onSaved`，完整源码仍计入同一撤销历史。 */
  replaceSource: (
    source: string,
    base: VersionSummary,
    onSaved?: (saved: Version) => void,
  ) => Promise<boolean>
  undo?: () => void
  redo?: () => void
  dismissDraft: () => void
}

/** 画板编辑只发布当前制品的完整版本；失败的候选源码不会覆盖新的头版本。 */
export function useCanvasBoardEditing({
  artifact,
  version,
  enabled,
  notifyAgent = true,
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
  const [reading, setReading] = useState(false)
  const latest = useRef({ artifact, version, enabled })
  latest.current = { artifact, version, enabled }
  const inFlight = useRef(false)
  const draft = pending?.artifactId === artifact.publicId ? pending : null
  const available = enabled && !draft && !reading
  // 不跨作者或页面编辑发布的新头版本重放旧快照。
  const timeline =
    history?.artifactId === artifact.publicId && history.version === version.version
      ? history.timeline
      : EMPTY_TIMELINE

  const save = async (edit: PendingEdit, onSaved?: (saved: Version) => void) => {
    const live = latest.current
    const sameBase =
      live.enabled &&
      live.artifact.publicId === edit.artifactId &&
      live.version.version === edit.base.version &&
      live.artifact.headVersion === edit.base.version
    if (!sameBase) {
      inFlight.current = false
      setPending({ ...edit, status: 'failed', error: '作品已更新，未覆盖新版本。' })
      return
    }
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
      query.setQueryData(
        artifactKeys.source(saved.artifact.publicId, saved.version.version),
        saved.version,
      )
      if (notifyAgent)
        await notifyHumanVersionEdit(artifact.projectId, saved.version, edit.base.source, 'canvas')
      setHistory({
        artifactId: artifact.publicId,
        version: saved.version.version,
        timeline: edit.timeline,
      })
      setPending(null)
      void query.invalidateQueries({ queryKey: artifactKeys.all })
      onVersionSaved?.(saved.version)
      onSaved?.(saved.version)
    } catch (cause) {
      setPending({
        ...edit,
        status: 'failed',
        error: cause instanceof Error ? cause.message : '无法保存改动',
      })
      if (cause instanceof ApiError && cause.status === 409) {
        void query.invalidateQueries({ queryKey: artifactKeys.canvas(artifact.publicId) })
      }
    } finally {
      inFlight.current = false
    }
  }

  const prepare = async (
    base: VersionSummary,
    transform: (full: Version) => Pick<PendingEdit, 'base' | 'source' | 'timeline'> | null,
    onSaved?: (saved: Version) => void,
  ): Promise<boolean> => {
    if (!available || inFlight.current) return false
    inFlight.current = true
    setInputError('')
    let publishing = false
    try {
      const inline = hasVersionSource(base)
      if (!inline) setReading(true)
      const full = inline
        ? base
        : await query.fetchQuery(artifactSourceOptions(base.artifactId, base.version))
      const change = transform(full)
      if (!change) return true
      publishing = true
      void save({ ...change, artifactId: base.artifactId, status: 'saving' }, onSaved)
      return true
    } catch (cause) {
      setInputError(cause instanceof Error ? cause.message : '无法应用改动')
      return false
    } finally {
      setReading(false)
      if (!publishing) inFlight.current = false
    }
  }

  const replay = (forward: boolean) => {
    if (!available) return
    const change = (forward ? timeline.future : timeline.past).at(-1)
    if (!change) return
    void prepare(version, (base) => ({
      base,
      source: forward ? change.after : change.before,
      timeline: forward
        ? { past: [...timeline.past, change], future: timeline.future.slice(0, -1) }
        : { past: timeline.past.slice(0, -1), future: [...timeline.future, change] },
    }))
  }

  const stage = (
    base: VersionSummary,
    edit: (full: Version) => CanvasSourceChange,
    onSaved?: (saved: Version) => void,
  ) => {
    return prepare(
      base,
      (full) => {
        const change = edit(full)
        if (change.after === full.source) return null
        return {
          base: full,
          source: change.after,
          timeline: { past: [...timeline.past.slice(1 - MAX_LOCAL_EDITS), change], future: [] },
        }
      },
      onSaved,
    )
  }

  return {
    version,
    draft,
    inputError,
    available,
    busy: reading || draft?.status === 'saving',
    undo: available && timeline.past.length ? () => replay(false) : undefined,
    redo: available && timeline.future.length ? () => replay(true) : undefined,
    change: (command, base = version) =>
      stage(base, (full) => editCanvasBoards(full.source, full.version, command)),
    replaceSource: (source, base, onSaved) => {
      return stage(
        base,
        (full) => ({
          before:
            artifact.type === 'artboard' && source !== full.source
              ? stabilizeArtboardSource(full.source, full.version)
              : full.source,
          after: source,
        }),
        onSaved,
      )
    },
    dismissDraft: () => {
      if (inFlight.current) return
      setPending(null)
      setInputError('')
    },
  }
}
