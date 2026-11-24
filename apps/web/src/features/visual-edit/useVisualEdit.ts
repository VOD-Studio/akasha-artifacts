import type { Artifact, EditOp, ElementRef, SandboxToShellMessage, Version } from '@akasha/protocol'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { artifactKeys } from '../../entities/artifact/queries'
import { feedbackKeys } from '../../entities/feedback/queries'
import {
  type ArtifactDetailResponse,
  fetchVisualEditTarget,
  fetchVisualUndo,
  parseVersionConflictDetails,
  previewVisualEdit,
  saveVisualEdit,
  type VisualEditCommand,
  type VisualEditTarget,
} from '../../shared/api/client'
import { ApiError } from '../../shared/api/error'
import type { ShellOutgoingPayload } from '../../shared/bridge/host'

interface Options {
  artifact: Artifact
  version: Version
  enabled: boolean
  send: (message: ShellOutgoingPayload) => void
  onAnnotate: (element: ElementRef) => void
  onVersionSaved?: (version: Version) => void
}

/** 当前选中的可直改目标；`baseVersion` 是选中它时所基于的版本。 */
export interface PickedTarget {
  baseVersion: number
  element: ElementRef
  loc: string
  target: VisualEditTarget
}

/**
 * 可视化直改控制器。
 *
 * @remarks `available` 只在查看头版本的 `react` 或 `html` 制品时为 true；
 * `active` 是当前生效的目标，所基于的版本不再是正在查看的版本时为 `null`。
 */
export interface VisualEditController {
  /** 当前制品与版本是否支持直改。 */
  available: boolean
  /** 是否处于点选目标的状态。 */
  isPicking: boolean
  active: PickedTarget | null
  busy: boolean
  /** 能否撤销最近一次直改。 */
  canUndo: boolean
  toggle: () => void
  cancel: () => void
  /** 处理沙盒上报的 `visual.select`：可直改的元素成为当前目标，否则转为批注。 */
  onMessage: (message: Extract<SandboxToShellMessage, { type: 'visual.select' }>) => Promise<void>
  annotate: (element: ElementRef) => void
  apply: (op: EditOp) => Promise<void>
  undo: () => Promise<void> | undefined
}

/**
 * L4 可视化直改的编排 Hook。
 *
 * @remarks 依赖制品与当前版本判断可用性，经 `send` 向沙盒开关点选。
 * `apply` 先让沙盒乐观预览，再保存；保存失败时让沙盒回滚预览，版本冲突时使版本缓存失效。
 * 保存成功后写入查询缓存，并使制品与反馈的查询失效。不再可用或卸载时自动取消点选。
 */
export function useVisualEdit(options: Options): VisualEditController {
  const { artifact, version, enabled } = options
  const optionsRef = useRef(options)
  optionsRef.current = options
  const queryClient = useQueryClient()
  const [isPicking, setPicking] = useState(false)
  const pickingRef = useRef(false)
  const revision = useRef(0)
  const [picked, setPicked] = useState<PickedTarget | null>(null)
  const [busy, setBusy] = useState(false)
  const saving = useRef(false)
  const available =
    enabled &&
    version.version === artifact.headVersion &&
    (artifact.type === 'react' || artifact.type === 'html')
  const active = available && picked?.baseVersion === version.version ? picked : null
  const { data: undo } = useQuery({
    queryKey: [...artifactKeys.detail(artifact.publicId, version.version), 'visual-undo'],
    queryFn: () =>
      fetchVisualUndo(artifact.publicId, {
        project: artifact.projectId,
        baseVersion: version.version,
      }),
    enabled: available && version.version > 1,
    retry: false,
  })
  const undoVersion = available ? (undo?.undoVersion ?? undefined) : undefined

  const cancel = useCallback(() => {
    revision.current++
    if (pickingRef.current) optionsRef.current.send({ type: 'visual.inspect', active: false })
    pickingRef.current = false
    setPicking(false)
    setPicked(null)
  }, [])

  useEffect(() => {
    return () => {
      revision.current++
      if (pickingRef.current) optionsRef.current.send({ type: 'visual.inspect', active: false })
      pickingRef.current = false
    }
  }, [])

  useEffect(() => {
    if (!available) cancel()
  }, [available, cancel])

  const toggle = () => {
    if (!available || saving.current) return
    if (pickingRef.current) {
      cancel()
      return
    }
    revision.current++
    setPicked(null)
    pickingRef.current = true
    setPicking(true)
    optionsRef.current.send({ type: 'visual.inspect', active: true })
  }

  const annotate = (element: ElementRef) => {
    cancel()
    optionsRef.current.onAnnotate(element)
  }

  const requestFailure = (error: unknown, fallback: string) => {
    const conflict = parseVersionConflictDetails(error)
    if (conflict) {
      toast.error(
        `v${conflict.baseVersion} 已更新至 v${conflict.headVersion}。请在最新版本重新选择元素。`,
      )
      void queryClient.invalidateQueries({ queryKey: artifactKeys.detailPrefix(artifact.publicId) })
      void queryClient.invalidateQueries({ queryKey: artifactKeys.versions(artifact.publicId) })
      return
    }
    toast.error(error instanceof Error ? error.message : fallback)
  }

  const onMessage = async (message: Extract<SandboxToShellMessage, { type: 'visual.select' }>) => {
    if (!available || !pickingRef.current || message.version !== version.version) return
    pickingRef.current = false
    setPicking(false)
    optionsRef.current.send({ type: 'visual.inspect', active: false })
    const { loc, element } = message
    const request = ++revision.current
    if (!loc) {
      toast.info('此元素仅支持批注')
      annotate(element)
      return
    }
    try {
      const { target } = await fetchVisualEditTarget(artifact.publicId, {
        project: artifact.projectId,
        baseVersion: message.version,
        loc,
      })
      if (request !== revision.current || optionsRef.current.version.version !== message.version)
        return
      if (!target) {
        toast.info('此元素仅支持批注')
        annotate(element)
      } else {
        setPicked({ baseVersion: message.version, loc, element, target })
      }
    } catch (error) {
      if (request === revision.current) requestFailure(error, '无法读取元素')
    }
  }

  const write = async (command: VisualEditCommand) => {
    if (!available || saving.current) return
    saving.current = true
    setBusy(true)
    const request = revision.current
    const input = { project: artifact.projectId, baseVersion: version.version, ...command }
    let sentPreview = false
    try {
      if ('op' in command) {
        const { source } = await previewVisualEdit(artifact.publicId, input)
        if (request !== revision.current || optionsRef.current.version.version !== version.version)
          return
        if (source === version.source) return
        optionsRef.current.send({
          type: 'apply.preview',
          version: version.version,
          op: command.op,
          source,
        })
        sentPreview = true
      }
      const saved = await saveVisualEdit(artifact.publicId, input)
      if (saved.version.version === version.version) return
      setPicked(null)
      queryClient.setQueryData<ArtifactDetailResponse>(
        artifactKeys.detail(artifact.publicId),
        (previous) => {
          if (!previous || previous.version.version >= saved.version.version) return previous
          return { ...previous, artifact: saved.artifact, version: saved.version }
        },
      )
      void queryClient.invalidateQueries({ queryKey: artifactKeys.all })
      void queryClient.invalidateQueries({ queryKey: feedbackKeys.list(artifact.publicId) })
      optionsRef.current.onVersionSaved?.(saved.version)
      toast.success(`已${'op' in command ? '保存' : '撤销'}，新版本为 v${saved.version.version}`)
    } catch (error) {
      if (sentPreview) optionsRef.current.send({ type: 'apply.rollback', version: version.version })
      if (
        active &&
        error instanceof ApiError &&
        error.details &&
        typeof error.details === 'object' &&
        'annotationOnly' in error.details
      ) {
        toast.info(error.message)
        annotate(active.element)
      } else {
        requestFailure(error, 'op' in command ? '保存失败' : '撤销失败')
      }
    } finally {
      saving.current = false
      setBusy(false)
    }
  }

  return {
    available,
    isPicking,
    active,
    busy,
    canUndo: undoVersion !== undefined,
    toggle,
    cancel,
    onMessage,
    annotate,
    apply: (op: EditOp) => write({ op }),
    undo: () => (undoVersion === undefined ? undefined : write({ undoVersion })),
  }
}
