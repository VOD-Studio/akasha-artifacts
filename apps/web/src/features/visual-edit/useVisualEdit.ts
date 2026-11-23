import type { Artifact, EditOp, ElementRef, SandboxToShellMessage, Version } from '@akasha/protocol'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { artifactKeys } from '../../entities/artifact/queries'
import { feedbackKeys } from '../../entities/feedback/queries'
import {
  ApiError,
  type ArtifactDetailResponse,
  fetchVisualEditTarget,
  fetchVisualUndo,
  parseVersionConflictDetails,
  previewVisualEdit,
  saveVisualEdit,
  type VisualEditCommand,
  type VisualEditTarget,
} from '../../shared/api/client'
import type { ShellOutgoingPayload } from '../../shared/bridge/host'

interface Options {
  artifact: Artifact
  version: Version
  enabled: boolean
  send: (message: ShellOutgoingPayload) => void
  onAnnotate: (element: ElementRef) => void
  onVersionSaved?: (version: Version) => void
}

export interface PickedTarget {
  baseVersion: number
  element: ElementRef
  loc: string
  target: VisualEditTarget
}

export interface VisualEditController {
  available: boolean
  isPicking: boolean
  active: PickedTarget | null
  busy: boolean
  canUndo: boolean
  toggle: () => void
  cancel: () => void
  onMessage: (message: Extract<SandboxToShellMessage, { type: 'visual.select' }>) => Promise<void>
  annotate: (element: ElementRef) => void
  apply: (op: EditOp) => Promise<void>
  undo: () => Promise<void> | undefined
}

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

  function toggle() {
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

  function annotate(element: ElementRef) {
    cancel()
    optionsRef.current.onAnnotate(element)
  }

  function requestFailure(error: unknown, fallback: string) {
    const conflict = parseVersionConflictDetails(error)
    if (conflict) {
      toast.error(
        `版本冲突：v${conflict.baseVersion} 已落后于 v${conflict.headVersion}，请在最新版本重新选取元素`,
      )
      void queryClient.invalidateQueries({ queryKey: artifactKeys.detailPrefix(artifact.publicId) })
      void queryClient.invalidateQueries({ queryKey: artifactKeys.versions(artifact.publicId) })
      return
    }
    toast.error(error instanceof Error ? error.message : fallback)
  }

  async function onMessage(message: Extract<SandboxToShellMessage, { type: 'visual.select' }>) {
    if (!available || !pickingRef.current || message.version !== version.version) return
    pickingRef.current = false
    setPicking(false)
    optionsRef.current.send({ type: 'visual.inspect', active: false })
    const { loc, element } = message
    const request = ++revision.current
    if (!loc) {
      toast.info('该元素由动态内容生成，仅支持批注')
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
        toast.info('该元素不是可直改的静态字面量，仅支持批注')
        annotate(element)
      } else {
        setPicked({ baseVersion: message.version, loc, element, target })
      }
    } catch (error) {
      if (request === revision.current) requestFailure(error, '获取直改能力失败')
    }
  }

  async function write(command: VisualEditCommand) {
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
      toast.success(
        `已${'op' in command ? '保存直改' : '撤销直改'}，生成 v${saved.version.version}`,
      )
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
        requestFailure(error, '直改写入失败')
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
