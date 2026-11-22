import type { ElementRef, Feedback, JsonPatchOp } from '@akasha/protocol'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useSelectionStore } from '../../entities/selection/store'
import { useWorkspaceStore } from '../../entities/workspace/store'
import { RuntimeErrorPanel } from '../../features/error-recovery/RuntimeErrorPanel'
import { selectActiveRound } from '../../features/review-rounds/round-utils'
import { VersionDiffView } from '../../features/version-diff/VersionDiffView'
import type { ArtifactDetailResponse } from '../../shared/api/client'
import {
  buildSandboxIframeUrl,
  createBridgeNonce,
  SANDBOX_IFRAME_SANDBOX_ATTR,
  SandboxBridgeHost,
} from '../../shared/bridge/host'
import { ElementOverlay } from '../../shared/overlay/ElementOverlay'
import { InspectorPanel } from '../InspectorPanel/InspectorPanel'
import { RoundSubmitBar } from '../RoundSubmitBar/RoundSubmitBar'

export interface ArtifactWorkspaceProps {
  detail: ArtifactDetailResponse
  versions: readonly ArtifactDetailResponse['version'][]
  feedbacks?: readonly Feedback[]
  sandboxOrigin: string
  onRegisterStateForwarder?: (forwarder: ((seq: number, ops: JsonPatchOp[]) => void) | null) => void
}

// Artifact 主画布工作区：通过独立 Origin + sandbox="allow-scripts"（严禁 allow-same-origin）隔离沙盒，
// 外壳叠层负责元素选中框与图钉绘制，右侧 InspectorPanel 与底部 RoundSubmitBar 组成完整的 L1 双向评审闭环。
export function ArtifactWorkspace({
  detail,
  versions,
  feedbacks = [],
  sandboxOrigin,
  onRegisterStateForwarder,
}: ArtifactWorkspaceProps) {
  const { artifact, version, state, rounds } = detail
  const viewMode = useWorkspaceStore((s) => s.viewMode)
  const inspectorOpen = useWorkspaceStore((s) => s.inspectorOpen)
  const setInspectorOpen = useWorkspaceStore((s) => s.setInspectorOpen)
  const sandboxError = useWorkspaceStore((s) => s.sandboxErrorByArtifact[artifact.publicId] ?? null)
  const setSandboxError = useWorkspaceStore((s) => s.setSandboxError)
  const setPreservedView = useWorkspaceStore((s) => s.setPreservedView)

  const pickerActive = useSelectionStore((s) => s.pickerActive)
  const setPickerActive = useSelectionStore((s) => s.setPickerActive)
  const hoveredElement = useSelectionStore((s) => s.hoveredElement)
  const setHoveredElement = useSelectionStore((s) => s.setHoveredElement)
  const selectedElement = useSelectionStore((s) => s.selectedByArtifact[artifact.publicId] ?? null)
  const setSelectedElement = useSelectionStore((s) => s.setSelectedElement)
  const focusedFeedbackId = useSelectionStore((s) => s.focusedFeedbackId)
  const setFocusedFeedbackId = useSelectionStore((s) => s.setFocusedFeedbackId)

  const activeRound = useMemo(() => selectActiveRound(rounds), [rounds])
  const versionPins = useMemo(
    () => feedbacks.filter((fb) => fb.version === version.version && Boolean(fb.element?.rect)),
    [feedbacks, version.version],
  )

  const iframeRef = useRef<HTMLIFrameElement>(null)
  const hostRef = useRef<SandboxBridgeHost | null>(null)
  const inspectingSentRef = useRef(false)
  const stateRef = useRef(state.snapshot)
  stateRef.current = state.snapshot
  const stateSeqRef = useRef(state.seq)
  stateSeqRef.current = state.seq
  const activeVersionRef = useRef(version.version)
  activeVersionRef.current = version.version
  const lastSyncedStateSeqRef = useRef<number>(-1)
  const lastRenderedKeyRef = useRef<string>('')

  const nonce = useMemo(() => {
    void artifact.publicId
    void sandboxOrigin
    return createBridgeNonce()
  }, [artifact.publicId, sandboxOrigin])

  const iframeSrc = useMemo(() => {
    const shellOrigin =
      typeof window !== 'undefined' && window.location.origin !== 'null'
        ? window.location.origin
        : 'http://127.0.0.1:24321'
    return buildSandboxIframeUrl(sandboxOrigin, nonce, shellOrigin)
  }, [sandboxOrigin, nonce])

  useEffect(() => {
    const host = new SandboxBridgeHost({
      sandboxOrigin,
      nonce,
      getIframeWindow: () => iframeRef.current?.contentWindow ?? null,
    })
    hostRef.current = host
    lastSyncedStateSeqRef.current = -1
    lastRenderedKeyRef.current = ''

    const off = host.onMessage((msg) => {
      if (msg.type === 'viewState.snapshot') {
        setPreservedView(artifact.publicId, msg.state)
      } else if (msg.type === 'error') {
        setSandboxError(artifact.publicId, {
          version: activeVersionRef.current,
          phase: msg.phase,
          message: msg.message,
          stack: msg.stack,
          loc: msg.loc,
        })
      } else if (msg.type === 'rendered') {
        setSandboxError(artifact.publicId, null)
        // 热更新重绘完成后若已有选中元素，通知沙盒重新计算该元素 rect，保持选中框不漂移
        const prevSelected = useSelectionStore.getState().selectedByArtifact[artifact.publicId]
        if (prevSelected) {
          host.send({ type: 'highlight', element: prevSelected })
        }
      } else if (msg.type === 'inspect.hover') {
        setHoveredElement(msg.element)
      } else if (msg.type === 'inspect.select') {
        setSelectedElement(artifact.publicId, msg.element)
        if (useSelectionStore.getState().pickerActive) {
          setPickerActive(false)
          setInspectorOpen(true)
        }
      }
    })

    host.start()
    onRegisterStateForwarder?.((seq, ops) => {
      if (seq > lastSyncedStateSeqRef.current) {
        lastSyncedStateSeqRef.current = seq
      }
      host.send({ type: 'state', seq, ops })
    })

    return () => {
      onRegisterStateForwarder?.(null)
      off()
      host.stop()
      hostRef.current = null
      inspectingSentRef.current = false
      setHoveredElement(null)
      setPickerActive(false)
    }
  }, [
    artifact.publicId,
    sandboxOrigin,
    nonce,
    setPreservedView,
    setSandboxError,
    setHoveredElement,
    setSelectedElement,
    setPickerActive,
    setInspectorOpen,
    onRegisterStateForwarder,
  ])

  // 同步指认模式开关到沙盒无 UI 命中探测器（仅在状态变化时下发，避免首屏无意义的 inspect.stop）
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const shouldInspect = pickerActive && viewMode === 'preview'
    if (shouldInspect) {
      inspectingSentRef.current = true
      host.send({ type: 'inspect.start' })
    } else if (inspectingSentRef.current) {
      inspectingSentRef.current = false
      host.send({ type: 'inspect.stop' })
    }
  }, [pickerActive, viewMode])

  // 当 Artifact 版本或源码更新时下发 render，并清除旧版本遗留的错误面板，携带保态快照。
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const existingErr = useWorkspaceStore.getState().sandboxErrorByArtifact[artifact.publicId]
    if (existingErr && existingErr.version !== version.version) {
      setSandboxError(artifact.publicId, null)
    }
    const preservedState = useWorkspaceStore.getState().preservedViewByArtifact[artifact.publicId]
    host.send({
      type: 'render',
      artifactType: artifact.type,
      version: version.version,
      source: version.source,
      state: stateRef.current,
      ...(preservedState ? { preservedState } : {}),
    })
    lastSyncedStateSeqRef.current = stateSeqRef.current
    lastRenderedKeyRef.current = `${artifact.publicId}:${version.version}`
  }, [artifact.publicId, artifact.type, version.version, version.source, setSandboxError])

  // 当 WS 断线 resync 刷新了服务端状态快照但源码版本未变时，仅以根路径 RFC 6902 replace 同步最新状态。
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    if (lastRenderedKeyRef.current !== `${artifact.publicId}:${version.version}`) return
    if (state.seq <= lastSyncedStateSeqRef.current || state.seq < 1) return
    lastSyncedStateSeqRef.current = state.seq
    host.send({
      type: 'state',
      seq: state.seq,
      ops: [{ op: 'replace', path: '', value: state.snapshot }],
    })
  }, [artifact.publicId, version.version, state.seq, state.snapshot])

  const handleHighlightElement = useCallback(
    (element: ElementRef) => {
      setSelectedElement(artifact.publicId, element)
      hostRef.current?.send({ type: 'highlight', element })
    },
    [artifact.publicId, setSelectedElement],
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-canvas">
      {sandboxError && sandboxError.version === version.version ? (
        <div className="shrink-0 border-b border-border bg-surface px-4 py-2">
          <RuntimeErrorPanel
            artifactId={artifact.publicId}
            projectId={artifact.projectId}
            version={sandboxError.version}
            source={version.source}
            error={sandboxError}
            onDismiss={() => setSandboxError(artifact.publicId, null)}
          />
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1">
        <div className="relative min-w-0 flex-1">
          {/* 保持沙盒 iframe 挂载，切到 Diff/源码 再切回预览时不丢失运行时状态 */}
          <iframe
            ref={iframeRef}
            title={`${artifact.title} 隔离沙盒`}
            src={iframeSrc}
            sandbox={SANDBOX_IFRAME_SANDBOX_ATTR}
            referrerPolicy="no-referrer"
            className={viewMode === 'preview' ? 'block h-full w-full border-0 bg-white' : 'hidden'}
          />

          {viewMode === 'preview' ? (
            <ElementOverlay
              hovered={hoveredElement}
              selected={selectedElement}
              pins={versionPins}
              focusedFeedbackId={focusedFeedbackId}
              onSelectPin={(fb) => {
                setFocusedFeedbackId(fb.id)
                setInspectorOpen(true)
                if (fb.element) handleHighlightElement(fb.element)
              }}
            />
          ) : null}

          {viewMode === 'diff' ? (
            <div className="h-full w-full">
              <VersionDiffView versions={versions} activeVersion={version.version} />
            </div>
          ) : null}

          {viewMode === 'source' ? (
            <div className="h-full w-full overflow-auto bg-surface p-4">
              <pre className="rounded-xl border border-border bg-surface-subtle p-4 font-mono text-xs leading-6 text-ink">
                <code>{version.source}</code>
              </pre>
            </div>
          ) : null}
        </div>

        {inspectorOpen ? (
          <InspectorPanel
            artifactId={artifact.publicId}
            projectId={artifact.projectId}
            activeVersion={version.version}
            activeRound={activeRound}
            feedbacks={feedbacks}
            onHighlightElement={handleHighlightElement}
            onClose={() => setInspectorOpen(false)}
          />
        ) : null}
      </div>

      <RoundSubmitBar
        artifactId={artifact.publicId}
        projectId={artifact.projectId}
        activeRound={activeRound}
        feedbacks={feedbacks}
      />
    </div>
  )
}
