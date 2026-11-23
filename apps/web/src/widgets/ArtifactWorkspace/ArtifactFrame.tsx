import type {
  Artifact,
  ElementRect,
  ElementRef,
  Feedback,
  JsonPatchOp,
  SandboxToShellMessage,
  StateStreamSnapshot,
  Version,
} from '@akasha/protocol'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useSelectionStore } from '../../entities/selection/store'
import { type SandboxErrorRecord, useWorkspaceStore } from '../../entities/workspace/store'
import { RuntimeErrorPanel } from '../../features/error-recovery/RuntimeErrorPanel'
import { submitArtifactFeedback } from '../../shared/api/client'
import {
  buildSandboxIframeUrl,
  createBridgeNonce,
  SANDBOX_IFRAME_SANDBOX_ATTR,
  SandboxBridgeHost,
  type ShellOutgoingPayload,
} from '../../shared/bridge/host'
import { createStorageRelay } from '../../shared/bridge/storage-relay'
import { ElementOverlay } from '../../shared/overlay/ElementOverlay'
import type { CanvasBoard } from './canvas-model'

export interface FrameConnection {
  send: (message: ShellOutgoingPayload) => void
  forwardState: (seq: number, ops: JsonPatchOp[]) => void
}

interface ArtifactFrameProps {
  artifact: Artifact
  version: Version
  board: CanvasBoard
  state: StateStreamSnapshot
  sandboxOrigin: string
  pins: readonly Feedback[]
  interactive: boolean
  register: (id: string, frame: FrameConnection | null) => void
  onVisualSelect: (message: Extract<SandboxToShellMessage, { type: 'visual.select' }>) => void
}

function belongsToBoard(element: ElementRef, id: string, scoped: boolean): boolean {
  return scoped ? element.boardId === id : element.boardId === undefined
}

function bindSandboxReference(element: ElementRef, id: string, scoped: boolean): ElementRef | null {
  if (!scoped) return belongsToBoard(element, id, false) ? element : null
  // 沙盒不能指定画板归属；容器的兼容 blockId 不应把新圈选重新定位到整张画板。
  const bound = { ...element, boardId: id }
  if (bound.blockId === id && bound.selector) delete bound.blockId
  delete bound.loc
  return bound.blockId || bound.selector || bound.textPreview ? bound : null
}

export function ArtifactFrame({
  artifact,
  version,
  board,
  state,
  sandboxOrigin,
  pins,
  interactive,
  register,
  onVisualSelect,
}: ArtifactFrameProps) {
  const artifactId = artifact.publicId
  const { id, scoped, type, source } = board
  const versionNumber = version.version
  const viewKey = scoped ? JSON.stringify([artifactId, id]) : artifactId
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const lastStateSeq = useRef(-1)
  const hadSelection = useRef(false)
  const { nonce, host } = useMemo(() => {
    // 画板改变作用域时必须重新握手，即使它恰好与默认画板同名。
    void artifactId
    void id
    void scoped
    const nonce = createBridgeNonce()
    return {
      nonce,
      host: new SandboxBridgeHost({
        nonce,
        sandboxOrigin,
        getIframeWindow: () => iframeRef.current?.contentWindow ?? null,
      }),
    }
  }, [artifactId, id, scoped, sandboxOrigin])
  const iframeSrc = useMemo(() => {
    const shellOrigin =
      typeof window !== 'undefined' && window.location.origin !== 'null'
        ? window.location.origin
        : 'http://127.0.0.1:24321'
    return buildSandboxIframeUrl(sandboxOrigin, nonce, shellOrigin)
  }, [sandboxOrigin, nonce])

  const [error, setError] = useState<SandboxErrorRecord | null>(null)
  const [hovered, setHovered] = useState<ElementRef | null>(null)
  const [livePinRects, setLivePinRects] = useState<Record<string, ElementRect | null>>({})
  const pickerActive = useSelectionStore((s) => s.pickerActive)
  const selection = useSelectionStore((s) => s.selectedByArtifact[artifactId] ?? null)
  const selected = selection && belongsToBoard(selection, id, scoped) ? selection : null
  const focusedFeedbackId = useSelectionStore((s) => s.focusedFeedbackId)
  const versionPins = useMemo(
    () => pins.filter((pin) => pin.element && belongsToBoard(pin.element, id, scoped)),
    [pins, id, scoped],
  )
  const render = useMemo(
    () => ({
      artifactType: type,
      version: versionNumber,
      source,
      boardId: scoped ? id : undefined,
    }),
    [type, source, versionNumber, scoped, id],
  )
  const applied = useRef<{
    render: typeof render
    pins: readonly Feedback[]
    inspecting: boolean
  } | null>(null)
  const latest = useRef({ state, versionNumber, versionPins, interactive, onVisualSelect })
  latest.current = { state, versionNumber, versionPins, interactive, onVisualSelect }

  useEffect(() => {
    applied.current = null
    lastStateSeq.current = -1
    const storage = createStorageRelay(artifactId, host)

    const send: FrameConnection['send'] = (message) => {
      if (message.type === 'highlight' && message.element) {
        if (!belongsToBoard(message.element, id, scoped)) return
      }
      if (message.type === 'pins.track') {
        host.send({
          ...message,
          pins: message.pins.filter(({ element }) => belongsToBoard(element, id, scoped)),
        })
        return
      }
      host.send(message)
    }
    const off = host.onMessage((message) => {
      const activeVersion = latest.current.versionNumber
      const selectionStore = useSelectionStore.getState()
      switch (message.type) {
        case 'viewState.snapshot':
          useWorkspaceStore.getState().setPreservedView(viewKey, message.state)
          break
        case 'error':
          setError({
            version: activeVersion,
            phase: message.phase,
            message: message.message,
            stack: message.stack,
            loc: scoped ? undefined : message.loc,
          })
          break
        case 'rendered': {
          if (message.version !== activeVersion) break
          setError(null)
          const currentSelection = selectionStore.selectedByArtifact[artifactId]
          if (currentSelection) send({ type: 'highlight', element: currentSelection })
          trackPins(host, latest.current.versionPins)
          break
        }
        case 'inspect.hover':
          if (!latest.current.interactive || !selectionStore.pickerActive) break
          setHovered(message.element ? bindSandboxReference(message.element, id, scoped) : null)
          break
        case 'inspect.select': {
          const element = bindSandboxReference(message.element, id, scoped)
          if (!element) break
          if (message.reason === 'sync') {
            const currentSelection = selectionStore.selectedByArtifact[artifactId]
            if (currentSelection && belongsToBoard(currentSelection, id, scoped)) {
              // 只刷新视口坐标，不覆盖批注携带的数据点、代码行等业务定位。
              selectionStore.setSelectedElement(artifactId, {
                ...currentSelection,
                rect: element.rect,
              })
            }
          } else if (latest.current.interactive) {
            selectionStore.setSelectedElement(artifactId, element)
            if (selectionStore.pickerActive) {
              selectionStore.setPickerActive(false)
              useWorkspaceStore.getState().setInspectorTab('review')
            }
          }
          break
        }
        case 'pins.rects':
          setLivePinRects(message.rects)
          break
        case 'storage.request':
          void storage.handle(message)
          break
        case 'visual.select': {
          if (!latest.current.interactive || message.version !== activeVersion) break
          const element = bindSandboxReference(message.element, id, scoped)
          if (element) {
            latest.current.onVisualSelect({
              ...message,
              element,
              loc: scoped ? undefined : message.loc,
            })
          }
          break
        }
        case 'annotation.request': {
          if (message.version !== activeVersion) break
          const element = bindSandboxReference(message.element, id, scoped)
          if (!element) break
          selectionStore.setSelectedElement(artifactId, element)
          send({ type: 'highlight', element })
          useWorkspaceStore.getState().setInspectorTab('review')
          break
        }
      }
    })

    host.start()
    register(id, {
      send,
      forwardState(seq, ops) {
        if (seq <= lastStateSeq.current) return
        lastStateSeq.current = seq
        host.send({ type: 'state', seq, ops })
      },
    })
    return () => {
      register(id, null)
      storage.dispose()
      off()
      host.stop()
    }
  }, [artifactId, id, scoped, viewKey, host, register])

  // 未 ready 的新 render 会替换队列；重新下发属于该帧的图钉和指认设定。
  useEffect(() => {
    const previous = applied.current
    const needsRender = previous?.render !== render
    if (needsRender) {
      const currentState = latest.current.state
      const preservedState = useWorkspaceStore.getState().preservedViewByArtifact[viewKey]
      host.send({
        type: 'render',
        ...render,
        state: currentState.snapshot,
        ...(preservedState ? { preservedState } : {}),
      })
      lastStateSeq.current = currentState.seq
      setError((current) => (current?.version === versionNumber ? current : null))
      setHovered(null)
      setLivePinRects({})
    }
    if (needsRender || previous?.pins !== versionPins) trackPins(host, versionPins)
    const inspecting = pickerActive && interactive
    if (inspecting && (needsRender || !previous?.inspecting)) {
      host.send({ type: 'inspect.start' })
    } else if (!inspecting && previous?.inspecting) {
      host.send({ type: 'inspect.stop' })
      setHovered(null)
    }
    applied.current = { render, pins: versionPins, inspecting }
  }, [host, interactive, pickerActive, render, versionNumber, versionPins, viewKey])

  // 切换板或清除批注引用时，让原板的沙盒退出对旧元素的坐标跟踪。
  useEffect(() => {
    if (!selected && hadSelection.current) host.send({ type: 'highlight', element: null })
    hadSelection.current = Boolean(selected)
  }, [host, selected])

  // WS 断线补齐快照时，以 RFC 6902 根路径 replace 同步未收到的状态。
  useEffect(() => {
    if (state.seq <= lastStateSeq.current || state.seq < 1) return
    lastStateSeq.current = state.seq
    host.send({
      type: 'state',
      seq: state.seq,
      ops: [{ op: 'replace', path: '', value: state.snapshot }],
    })
  }, [host, state.seq, state.snapshot])

  return (
    <div className="relative h-full w-full">
      <iframe
        key={nonce}
        ref={iframeRef}
        title={`${board.title} 隔离沙盒`}
        src={iframeSrc}
        width={board.width}
        height={board.height}
        sandbox={SANDBOX_IFRAME_SANDBOX_ATTR}
        referrerPolicy="no-referrer"
        inert={!interactive}
        tabIndex={interactive && !scoped ? undefined : -1}
        className={`block h-full w-full border-0 bg-white ${interactive ? 'pointer-events-auto' : 'pointer-events-none'}`}
      />
      <ElementOverlay
        hovered={pickerActive && interactive ? hovered : null}
        selected={selected}
        pins={versionPins}
        livePinRects={livePinRects}
        focusedFeedbackId={focusedFeedbackId}
        onSelectPin={(pin) => {
          const selectionStore = useSelectionStore.getState()
          selectionStore.setFocusedFeedbackId(pin.id)
          useWorkspaceStore.getState().setInspectorTab('review')
          if (pin.element) {
            selectionStore.setSelectedElement(artifactId, pin.element)
            host.send({ type: 'highlight', element: pin.element })
          }
        }}
      />
      {error?.version === versionNumber ? (
        <div className="pointer-events-auto absolute inset-x-0 bottom-0 z-20 max-h-full overflow-auto p-2">
          <RuntimeErrorPanel
            artifactId={viewKey}
            projectId={artifact.projectId}
            version={versionNumber}
            source={scoped ? source : version.source}
            error={error}
            onDismiss={() => setError(null)}
            onSubmitFeedback={
              scoped
                ? (_key, input) =>
                    submitArtifactFeedback(artifactId, {
                      ...input,
                      element: input.element ? { ...input.element, boardId: id } : input.element,
                    })
                : undefined
            }
          />
        </div>
      ) : null}
    </div>
  )
}

function trackPins(host: SandboxBridgeHost, pins: readonly Feedback[]): void {
  host.send({
    type: 'pins.track',
    pins: pins.flatMap((pin) => (pin.element ? [{ id: pin.id, element: pin.element }] : [])),
  })
}
