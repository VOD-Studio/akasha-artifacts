import {
  type Artifact,
  type CanvasLayer,
  DESIGN_LAYER_BLOCK_PREFIX,
  type ElementRect,
  type ElementRef,
  type Feedback,
  type JsonPatchOp,
  type SandboxToShellMessage,
  type StateStreamSnapshot,
  type Version,
} from '@akasha/protocol'
import { useEffect, useMemo, useRef, useState } from 'react'
import { selectionForVersion, useSelectionStore } from '../../entities/selection/store'
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

/** 一块画板的沙盒向外壳提供的连接，登记到工作区后由工作区使用。 */
export interface FrameConnection {
  /** 向该沙盒发送 Bridge 指令。 */
  send: (message: ShellOutgoingPayload) => void
  /** 把状态补丁转发给该沙盒。 */
  forwardState: (seq: number, ops: JsonPatchOp[]) => void
}

/** 试玩有自己的输入和导航，不能调用设计视图的选区、批注或直改操作。 */
export type BoardFramePurpose =
  | { type: 'overview'; interactive: boolean }
  | { type: 'focus' }
  | { type: 'play'; onNavigate: (target: string) => void; onExit: () => void }

interface ArtifactFrameProps {
  artifact: Artifact
  version: Version
  board: CanvasBoard
  state: StateStreamSnapshot
  sandboxOrigin: string
  pins: readonly Feedback[]
  purpose: BoardFramePurpose
  /** 只有设计视图登记；试玩不接收设计视图的指认或编辑指令。 */
  register?: (id: string, frame: FrameConnection | null) => void
  onPlayable: (board: CanvasBoard, version: number, playable: boolean) => void
  watchLayers: boolean
  onLayers: (id: string, version: number, layers: CanvasLayer[], truncated: boolean) => void
  onLayerPicked: (id: string) => void
  /** 仅把当前设计帧的命中回报交给工作区；请求标识由工作区核对。 */
  onTextTarget: (
    boardId: string,
    message: Extract<SandboxToShellMessage, { type: 'inspect.text.target' }>,
  ) => void
  /** 直改模式下沙盒上报选中元素时调用。 */
  onVisualSelect: (message: Extract<SandboxToShellMessage, { type: 'visual.select' }>) => void
}

function belongsToBoard(element: ElementRef, id: string, scoped: boolean): boolean {
  return scoped ? element.boardId === id : element.boardId === undefined
}

function bindSandboxReference(element: ElementRef, board: CanvasBoard): ElementRef | null {
  const { id, scoped } = board
  if (!scoped) return belongsToBoard(element, id, false) ? element : null
  // 沙盒不能指定画板归属或给作者 HTML 伪造原生图层的标识。
  const bound = { ...element, boardId: id }
  if (
    (bound.blockId === id && bound.selector) ||
    (bound.blockId?.startsWith(DESIGN_LAYER_BLOCK_PREFIX) &&
      !board.designLayers?.some(
        (layer) => bound.blockId === `${DESIGN_LAYER_BLOCK_PREFIX}${layer.id}`,
      ))
  ) {
    delete bound.blockId
  }
  delete bound.loc
  return bound.blockId || bound.selector || bound.textPreview ? bound : null
}

/**
 * 单块画板的独立沙盒：每块画板一个隔离的 iframe，外壳叠层负责选区与图钉。
 *
 * @remarks 画板改变作用域时会重新握手，即使它恰好与默认画板同名。
 */
export function ArtifactFrame({
  artifact,
  version,
  board,
  state,
  sandboxOrigin,
  pins,
  purpose,
  register,
  onPlayable,
  watchLayers,
  onLayers,
  onLayerPicked,
  onTextTarget,
  onVisualSelect,
}: ArtifactFrameProps) {
  const artifactId = artifact.publicId
  const { id, scoped, source, type, designLayers } = board
  const versionNumber = version.version
  const playback = purpose.type === 'play'
  const focused = purpose.type === 'focus'
  const isolated = focused || playback
  const interactive = playback || (purpose.type === 'overview' && purpose.interactive)
  const viewKey = focused
    ? JSON.stringify([artifactId, id, 'focus'])
    : scoped
      ? JSON.stringify([artifactId, id])
      : artifactId
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
  const selection = useSelectionStore((s) => selectionForVersion(s, artifactId, versionNumber))
  const selected =
    !playback && selection && belongsToBoard(selection, id, scoped) ? selection : null
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
      designLayers,
      boardId: scoped ? id : undefined,
      playback: playback ? (true as const) : undefined,
    }),
    [type, source, versionNumber, scoped, id, playback, designLayers],
  )
  const applied = useRef<{
    render: typeof render
    pins: readonly Feedback[]
    inspecting: boolean
    watchingLayers: boolean
  } | null>(null)
  const latest = useRef({
    state,
    versionNumber,
    versionPins,
    interactive,
    onVisualSelect,
    purpose,
    board,
    onPlayable,
    watchLayers,
    onLayers,
    onLayerPicked,
    onTextTarget,
  })
  latest.current = {
    state,
    versionNumber,
    versionPins,
    interactive,
    onVisualSelect,
    purpose,
    board,
    onPlayable,
    watchLayers,
    onLayers,
    onLayerPicked,
    onTextTarget,
  }

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
          if (!playback) useWorkspaceStore.getState().setPreservedView(viewKey, message.state)
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
          if (playback) break
          latest.current.onPlayable(latest.current.board, activeVersion, message.playable === true)
          const currentSelection = selectionForVersion(selectionStore, artifactId, activeVersion)
          const layer = selectionStore.layersByArtifact[artifactId]
          if (currentSelection) {
            send({ type: 'highlight', element: currentSelection, ...(layer ? { layer } : {}) })
          }
          trackPins(host, latest.current.versionPins)
          break
        }
        case 'inspect.layers.snapshot':
          if (!isolated && latest.current.watchLayers && message.version === activeVersion) {
            latest.current.onLayers(id, activeVersion, message.layers, message.truncated)
          }
          break
        case 'inspect.text.target':
          if (!isolated && message.version === activeVersion) {
            const element = message.element
              ? bindSandboxReference(message.element, latest.current.board)
              : null
            latest.current.onTextTarget(id, { ...message, element })
          }
          break
        case 'inspect.hover':
          if (isolated || !latest.current.interactive || !selectionStore.pickerActive) break
          setHovered(
            message.element ? bindSandboxReference(message.element, latest.current.board) : null,
          )
          break
        case 'inspect.select': {
          if (isolated) break
          if (message.version !== undefined && message.version !== activeVersion) break
          const element = bindSandboxReference(message.element, latest.current.board)
          if (!element) break
          if (message.reason === 'sync') {
            const currentSelection = selectionForVersion(selectionStore, artifactId, activeVersion)
            const layer = selectionStore.layersByArtifact[artifactId]
            if (!currentSelection || !belongsToBoard(currentSelection, id, scoped)) break
            if (layer && (layer.id !== message.layerId || message.version !== activeVersion)) break
            // 保留业务定位；运行节点重排后只跟踪同一个节点的新选择器。
            selectionStore.setSelectedElement(
              artifactId,
              {
                ...currentSelection,
                ...(layer && message.layerSelector ? { selector: message.layerSelector } : {}),
                rect: element.rect,
              },
              layer,
            )
          } else if (latest.current.interactive && selectionStore.pickerActive) {
            const workspace = useWorkspaceStore.getState()
            if (
              workspace.inspectorTab === 'inspect' &&
              message.layerId &&
              message.layerSelector &&
              message.version === activeVersion
            ) {
              selectionStore.setSelectedElement(
                artifactId,
                {
                  selector: message.layerSelector,
                  rect: element.rect,
                  ...(element.blockId?.startsWith(DESIGN_LAYER_BLOCK_PREFIX)
                    ? { blockId: element.blockId }
                    : {}),
                  ...(scoped ? { boardId: id } : {}),
                },
                { id: message.layerId, version: activeVersion },
              )
              latest.current.onLayerPicked(id)
            } else {
              selectionStore.setSelectedElement(artifactId, element)
              if (workspace.inspectorTab !== 'inspect') workspace.setInspectorTab('review')
            }
            selectionStore.setPickerActive(false)
          }
          break
        }
        case 'pins.rects':
          setLivePinRects(message.rects)
          break
        case 'storage.request':
          if (
            isolated &&
            (message.operation.action === 'set' || message.operation.action === 'delete')
          ) {
            host.send({
              type: 'storage.response',
              requestId: message.requestId,
              ok: false,
              error: '聚焦与试玩不能修改制品存储',
            })
            break
          }
          void storage.handle(message)
          break
        case 'visual.select': {
          if (isolated || !latest.current.interactive || message.version !== activeVersion) break
          const element = bindSandboxReference(message.element, latest.current.board)
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
          if (isolated || message.version !== activeVersion) break
          const element = bindSandboxReference(message.element, latest.current.board)
          if (!element) break
          selectionStore.setSelectedElement(artifactId, element)
          send({ type: 'highlight', element })
          useWorkspaceStore.getState().setInspectorTab('review')
          break
        }
        case 'prototype.availability':
          if (!playback && message.version === activeVersion) {
            latest.current.onPlayable(latest.current.board, activeVersion, message.playable)
          }
          break
        case 'prototype.navigate': {
          const target = latest.current.purpose
          if (target.type === 'play' && message.version === activeVersion) {
            target.onNavigate(message.target)
          }
          break
        }
        case 'prototype.exit': {
          const target = latest.current.purpose
          if (target.type === 'play' && message.version === activeVersion) target.onExit()
          break
        }
      }
    })

    host.start()
    register?.(id, {
      send,
      forwardState(seq, ops) {
        if (seq <= lastStateSeq.current) return
        lastStateSeq.current = seq
        host.send({ type: 'state', seq, ops })
      },
    })
    return () => {
      register?.(id, null)
      storage.dispose()
      off()
      host.stop()
    }
  }, [artifactId, id, scoped, isolated, playback, viewKey, host, register])

  // 未 ready 的新 render 会替换队列；重新下发属于该帧的图钉和指认设定。
  useEffect(() => {
    const previous = applied.current
    const needsRender = previous?.render !== render
    if (needsRender) {
      const currentState = latest.current.state
      const preservedState = playback
        ? undefined
        : useWorkspaceStore.getState().preservedViewByArtifact[viewKey]
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
    const watchingLayers = !isolated && watchLayers
    if ((needsRender && watchingLayers) || watchingLayers !== (previous?.watchingLayers ?? false)) {
      host.send({ type: 'inspect.layers.watch', active: watchingLayers })
    }
    if (!playback && (needsRender || previous?.pins !== versionPins)) trackPins(host, versionPins)
    const inspecting = !isolated && pickerActive && interactive
    if (inspecting && (needsRender || !previous?.inspecting)) {
      host.send({ type: 'inspect.start' })
    } else if (!inspecting && previous?.inspecting) {
      host.send({ type: 'inspect.stop' })
      setHovered(null)
    }
    applied.current = { render, pins: versionPins, inspecting, watchingLayers }
  }, [
    host,
    interactive,
    isolated,
    pickerActive,
    playback,
    render,
    versionNumber,
    versionPins,
    viewKey,
    watchLayers,
  ])

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
        tabIndex={interactive && (playback || !scoped) ? undefined : -1}
        className={`block h-full w-full border-0 bg-white ${interactive ? 'pointer-events-auto' : 'pointer-events-none'}`}
      />
      {!playback ? (
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
      ) : null}
      {error?.version === versionNumber ? (
        <div className="pointer-events-auto absolute inset-x-0 bottom-0 z-20 max-h-full overflow-auto p-2">
          {playback ? (
            <p role="alert" className="rounded border border-border bg-surface p-3 text-sm">
              无法试玩该画板：{error.message}
            </p>
          ) : (
            <RuntimeErrorPanel
              artifactId={scoped ? viewKey : artifactId}
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
          )}
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
