import type { ElementRect, ElementRef, Feedback, JsonPatchOp, ReviewRound } from '@akasha/protocol'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSelectionStore } from '../../entities/selection/store'
import { useWorkspaceStore } from '../../entities/workspace/store'
import { SplitCodeEditor } from '../../features/code-editor/SplitCodeEditor'
import { RuntimeErrorPanel } from '../../features/error-recovery/RuntimeErrorPanel'
import { selectActiveRound } from '../../features/review-rounds/round-utils'
import { VersionDiffView } from '../../features/version-diff/VersionDiffView'
import { useVisualEdit } from '../../features/visual-edit/useVisualEdit'
import { VisualEditPanel } from '../../features/visual-edit/VisualEditPanel'
import type { ArtifactDetailResponse } from '../../shared/api/client'
import { syncProjectSelection } from '../../shared/api/client'
import {
  buildSandboxIframeUrl,
  createBridgeNonce,
  SANDBOX_IFRAME_SANDBOX_ATTR,
  SandboxBridgeHost,
} from '../../shared/bridge/host'
import { createStorageRelay } from '../../shared/bridge/storage-relay'
import { ElementOverlay } from '../../shared/overlay/ElementOverlay'
import { InspectorPanel } from '../InspectorPanel/InspectorPanel'
import { ArtifactCanvas } from './ArtifactCanvas'

const EMPTY_FEEDBACKS: readonly Feedback[] = []

export interface ArtifactWorkspaceProps {
  detail: ArtifactDetailResponse
  versions: readonly ArtifactDetailResponse['version'][]
  feedbacks?: readonly Feedback[]
  rounds?: readonly ReviewRound[]
  sandboxOrigin: string
  onRegisterStateForwarder?: (forwarder: ((seq: number, ops: JsonPatchOp[]) => void) | null) => void
  onVersionSaved?: (version: ArtifactDetailResponse['version']) => void
  onVersionAdopted?: (version: ArtifactDetailResponse['version']) => void
}

// Artifact 主画布工作区：通过独立 Origin + sandbox="allow-scripts"（严禁 allow-same-origin）隔离沙盒，
// 外壳叠层负责元素选中框与图钉绘制，支持 L1 批注评审、L2 属性面板与 L3 CodeMirror 分栏实时编辑。
export function ArtifactWorkspace({
  detail,
  versions,
  feedbacks = EMPTY_FEEDBACKS,
  rounds: roundsOverride,
  sandboxOrigin,
  onRegisterStateForwarder,
  onVersionSaved,
  onVersionAdopted,
}: ArtifactWorkspaceProps) {
  const { artifact, version, state } = detail
  const rounds = roundsOverride ?? detail.rounds
  const [livePinRects, setLivePinRects] = useState<Record<string, ElementRect | null>>({})
  const [liveEditSource, setLiveEditSource] = useState<string | null>(null)
  const latestVersion = useMemo(() => {
    if (versions.length === 0) return version
    return versions.reduce(
      (acc, cur) => (cur.version > acc.version ? cur : acc),
      versions[0] ?? version,
    )
  }, [versions, version])
  const viewMode = useWorkspaceStore((s) => s.viewMode)
  const showCanvas = viewMode === 'preview' || viewMode === 'edit'
  // 首次进入编辑态后保持编辑器挂载（切换回预览/Diff/源码时仅隐藏），防止丢失未保存草稿与撤销栈
  const [editorMounted, setEditorMounted] = useState(viewMode === 'edit')
  useEffect(() => {
    if (viewMode === 'edit') {
      setEditorMounted(true)
    }
  }, [viewMode])
  const setInspectorTab = useWorkspaceStore((s) => s.setInspectorTab)
  const inspectorOpen = useWorkspaceStore((s) => s.inspectorTab !== null)
  const sandboxError = useWorkspaceStore((s) => s.sandboxErrorByArtifact[artifact.publicId] ?? null)
  const setSandboxError = useWorkspaceStore((s) => s.setSandboxError)
  const setPreservedView = useWorkspaceStore((s) => s.setPreservedView)
  const unsentDraft = useWorkspaceStore((s) => s.unsentDraftsByArtifact[artifact.publicId] ?? '')

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
    () => feedbacks.filter((fb) => fb.version === version.version && Boolean(fb.element)),
    [feedbacks, version.version],
  )
  const pinTrackSignature = useMemo(
    () =>
      JSON.stringify(
        versionPins.map((fb) => ({
          id: fb.id,
          blockId: fb.element?.blockId,
          loc: fb.element?.loc,
          selector: fb.element?.selector,
          textPreview: fb.element?.textPreview,
        })),
      ),
    [versionPins],
  )
  const versionPinsRef = useRef(versionPins)
  versionPinsRef.current = versionPins
  const hadSelectionRef = useRef(false)
  // 初始置为 null：页面刷新后客户端选区清空，首次挂载仍须同步一次以清理 Daemon 上残留的旧选区。
  const lastSyncedSelectionRef = useRef<string | null>(null)

  const iframeRef = useRef<HTMLIFrameElement>(null)
  const hostRef = useRef<SandboxBridgeHost | null>(null)
  const visual = useVisualEdit({
    artifact,
    version,
    enabled: viewMode === 'preview' && latestVersion.version === version.version,
    send: (message) => hostRef.current?.send(message),
    onAnnotate: (element) => {
      setSelectedElement(artifact.publicId, element)
      hostRef.current?.send({ type: 'highlight', element })
      setInspectorTab('review')
    },
    onVersionSaved,
  })
  const handleVisualMessageRef = useRef(visual.onMessage)
  handleVisualMessageRef.current = visual.onMessage
  const cancelVisual = visual.cancel
  useEffect(() => {
    if (inspectorOpen) cancelVisual()
  }, [inspectorOpen, cancelVisual])
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
    const storage = createStorageRelay(artifact.publicId, host)

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
        // 热更新重绘完成后同步已有选中元素与当前版本图钉到沙盒重算最新视口坐标
        const prevSelected = useSelectionStore.getState().selectedByArtifact[artifact.publicId]
        if (prevSelected) {
          host.send({ type: 'highlight', element: prevSelected })
        }
        const pinPayload = versionPinsRef.current.flatMap((fb) =>
          fb.element ? [{ id: fb.id, element: fb.element }] : [],
        )
        host.send({ type: 'pins.track', pins: pinPayload })
      } else if (msg.type === 'inspect.hover') {
        setHoveredElement(msg.element)
      } else if (msg.type === 'inspect.select') {
        if (msg.reason === 'sync') {
          // 只更新几何坐标，保留圈选数据点或代码行的业务引用。
          const selected = useSelectionStore.getState().selectedByArtifact[artifact.publicId]
          if (selected)
            setSelectedElement(artifact.publicId, { ...selected, rect: msg.element.rect })
        } else {
          setSelectedElement(artifact.publicId, msg.element)
          if (useSelectionStore.getState().pickerActive) {
            setPickerActive(false)
            setInspectorTab('review')
          }
        }
      } else if (msg.type === 'pins.rects') {
        setLivePinRects(msg.rects)
      } else if (msg.type === 'storage.request') {
        void storage.handle(msg)
      } else if (msg.type === 'visual.select') {
        handleVisualMessageRef.current(msg)
      } else if (msg.type === 'annotation.request' && msg.version === activeVersionRef.current) {
        setSelectedElement(artifact.publicId, msg.element)
        host.send({ type: 'highlight', element: msg.element })
        setInspectorTab('review')
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
      storage.dispose()
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
    setInspectorTab,
    onRegisterStateForwarder,
  ])

  // 同步指认模式开关到沙盒无 UI 命中探测器（仅在状态变化时下发，避免首屏无意义的 inspect.stop）
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const shouldInspect = pickerActive && (viewMode === 'preview' || viewMode === 'edit')
    if (shouldInspect) {
      inspectingSentRef.current = true
      host.send({ type: 'inspect.start' })
    } else if (inspectingSentRef.current) {
      inspectingSentRef.current = false
      host.send({ type: 'inspect.stop' })
    }
  }, [pickerActive, viewMode])

  // 当用户在批注撰写器中清除选中元素时，同步下发 highlight(null) 清理沙盒内旧 selectedEl，防止滚动后复活
  useEffect(() => {
    if (selectedElement) {
      hadSelectionRef.current = true
      return
    }
    if (hadSelectionRef.current) {
      hadSelectionRef.current = false
      hostRef.current?.send({ type: 'highlight', element: null })
    }
  }, [selectedElement])

  // 将浏览器当前选区与未提交草稿防抖同步至本机 Daemon，供终端 Hook 在用户提问时无感注入上下文。
  useEffect(() => {
    const trimmedDraft = unsentDraft.trim()
    const sig = JSON.stringify({
      projectId: artifact.projectId,
      artifactId: artifact.publicId,
      element: selectedElement,
      draftText: trimmedDraft,
    })
    if (sig === lastSyncedSelectionRef.current) return
    const timer = setTimeout(() => {
      lastSyncedSelectionRef.current = sig
      void syncProjectSelection(artifact.projectId, {
        artifactId: artifact.publicId,
        element: selectedElement,
        ...(trimmedDraft ? { draftText: trimmedDraft } : {}),
      })
    }, 150)
    return () => clearTimeout(timer)
  }, [artifact.projectId, artifact.publicId, selectedElement, unsentDraft])

  const effectivePreviewSource =
    viewMode === 'edit' && liveEditSource !== null ? liveEditSource : version.source

  // 当 Artifact 版本、源码或 L3 实时草稿更新时下发 render，并清除旧版本遗留的错误面板，携带保态快照。
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
      source: effectivePreviewSource,
      state: stateRef.current,
      ...(preservedState ? { preservedState } : {}),
    })
    lastSyncedStateSeqRef.current = stateSeqRef.current
    lastRenderedKeyRef.current = `${artifact.publicId}:${version.version}`
  }, [artifact.publicId, artifact.type, version.version, effectivePreviewSource, setSandboxError])

  // 置于 render effect 之后：确保首屏队列先发 render 再发 pins.track，避免被 render 清空预热队列。
  useEffect(() => {
    void pinTrackSignature
    const host = hostRef.current
    if (!host) return
    const currentPins = versionPinsRef.current
    const pinPayload = currentPins.flatMap((fb) =>
      fb.element ? [{ id: fb.id, element: fb.element }] : [],
    )
    const activeIds = new Set(pinPayload.map((p) => p.id))
    setLivePinRects((prev) => {
      const keys = Object.keys(prev)
      if (keys.every((k) => activeIds.has(k))) return prev
      const next: Record<string, ElementRect | null> = {}
      for (const k of keys) {
        if (activeIds.has(k)) next[k] = prev[k] ?? null
      }
      return next
    })
    host.send({ type: 'pins.track', pins: pinPayload })
  }, [pinTrackSignature])

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

      <main className="flex min-h-0 min-w-0 flex-1 flex-col md:flex-row">
        {editorMounted ? (
          <div
            className={viewMode === 'edit' ? 'h-1/2 min-h-0 shrink-0 md:h-auto md:w-1/2' : 'hidden'}
          >
            <SplitCodeEditor
              artifact={artifact}
              version={version}
              latestVersion={latestVersion}
              onLivePreviewChange={setLiveEditSource}
              onVersionSaved={onVersionSaved}
              onVersionAdopted={onVersionAdopted}
            />
          </div>
        ) : null}

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {/* 工具视图只隐藏画布；切回时保留同一沙盒与用户视角。 */}
          <ArtifactCanvas
            visible={showCanvas}
            visualEdit={
              visual.available
                ? {
                    isPicking: visual.isPicking,
                    cancel: visual.cancel,
                    toggle: () => {
                      setInspectorTab(null)
                      visual.toggle()
                    },
                  }
                : undefined
            }
          >
            <iframe
              ref={iframeRef}
              title={`${artifact.title} 隔离沙盒`}
              src={iframeSrc}
              sandbox={SANDBOX_IFRAME_SANDBOX_ATTR}
              referrerPolicy="no-referrer"
              className="block h-full w-full border-0 bg-white"
            />
            {showCanvas ? (
              <ElementOverlay
                hovered={hoveredElement}
                selected={selectedElement}
                pins={versionPins}
                livePinRects={livePinRects}
                focusedFeedbackId={focusedFeedbackId}
                onSelectPin={(fb) => {
                  setFocusedFeedbackId(fb.id)
                  setInspectorTab('review')
                  if (fb.element) handleHighlightElement(fb.element)
                }}
              />
            ) : null}
          </ArtifactCanvas>

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
      </main>

      <InspectorPanel
        artifactId={artifact.publicId}
        projectId={artifact.projectId}
        artifactType={artifact.type}
        source={version.source}
        stateSnapshot={state.snapshot}
        activeVersion={version.version}
        activeRound={activeRound}
        feedbacks={feedbacks}
        onHighlightElement={handleHighlightElement}
      />
      <VisualEditPanel controller={visual} />
    </div>
  )
}
