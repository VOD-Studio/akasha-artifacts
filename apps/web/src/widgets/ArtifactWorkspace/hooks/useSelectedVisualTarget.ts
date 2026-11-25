import type { Artifact, EditOp, VersionSummary } from '@akasha/protocol'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  fetchVisualEditTarget,
  previewVisualEdit,
  type VisualEditTarget,
} from '@/features/visual-edit'
import type { CanvasBoardEditing } from './useCanvasBoardEditing'

interface TargetInput {
  artifact: Artifact
  version: VersionSummary
  boardId?: string
  scoped: boolean
  loc?: string
  enabled: boolean
  editing?: CanvasBoardEditing
}

/**
 * 为当前选中的静态 HTML/React 运行图层拉取直改能力，并将直改统一走画布版本历史提交。
 *
 * @remarks 只在可写头版本且目标具有唯一 `sourceLoc` 时查询；切换选区或版本后立即丢弃旧结果。
 */
export function useSelectedVisualTarget({
  artifact,
  version,
  boardId,
  scoped,
  loc,
  enabled,
  editing,
}: TargetInput) {
  const scope =
    enabled && loc ? JSON.stringify([artifact.publicId, version.version, boardId, loc]) : ''
  const [state, setState] = useState<{ scope: string; target: VisualEditTarget | null } | null>(
    null,
  )
  const latest = useRef({ artifact, version, boardId, scoped, editing, enabled })
  latest.current = { artifact, version, boardId, scoped, editing, enabled }

  useEffect(() => {
    if (!scope || !loc) return
    let active = true
    void fetchVisualEditTarget(artifact.publicId, {
      project: artifact.projectId,
      baseVersion: version.version,
      boardId: scoped ? boardId : undefined,
      loc,
    })
      .then(({ target }) => {
        if (active) setState({ scope, target })
      })
      .catch(() => {
        if (active) setState({ scope, target: null })
      })
    return () => {
      active = false
    }
  }, [artifact.projectId, artifact.publicId, boardId, loc, scope, scoped, version.version])

  const applyOp = useCallback(async (op: EditOp): Promise<boolean> => {
    const live = latest.current
    if (!live.enabled || !live.editing?.available) return false
    const base = live.version
    try {
      const { source } = await previewVisualEdit(base.artifactId, {
        project: live.artifact.projectId,
        baseVersion: base.version,
        boardId: live.scoped ? live.boardId : undefined,
        op,
      })
      if (latest.current.version.version !== base.version) return false
      return await live.editing.replaceSource(source, base)
    } catch {
      return false
    }
  }, [])

  return {
    target: state?.scope === scope ? state.target : null,
    applyOp,
  }
}
