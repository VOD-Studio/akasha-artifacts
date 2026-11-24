import {
  type Artifact,
  CANVAS_PREVIEW_MAX_EDGE,
  type CanvasLayer,
  DESIGN_LAYER_BLOCK_PREFIX,
  type ElementRect,
  type ElementRef,
  type Feedback,
  type JsonPatchOp,
  resolveArtboardTweaks,
  type SandboxToShellMessage,
  type StateStreamSnapshot,
  type VersionSummary,
} from '@akasha/protocol'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from 'zustand'
import type { CanvasBoard, LoadedCanvasBoard } from '@/entities/artifact'
import { submitArtifactFeedback } from '@/entities/feedback'
import { selectionForVersion, useSelectionStore } from '@/entities/selection'
import { type SandboxErrorRecord, useWorkspaceStore } from '@/entities/workspace'
import { RuntimeErrorPanel } from '@/features/error-recovery'
import {
  buildSandboxIframeUrl,
  createBridgeNonce,
  SANDBOX_IFRAME_SANDBOX_ATTR,
  SandboxBridgeHost,
  type ShellOutgoingPayload,
} from '@/shared/bridge/host'
import { createStorageRelay } from '@/shared/bridge/storage-relay'
import { ElementOverlay } from '@/shared/overlay/ElementOverlay'
import type { BoardTweakPreviewStore } from './board-tweak-previews'

/** 一块画板的沙盒向外壳提供的连接，登记到工作区后由工作区使用。 */
export interface FrameConnection {
  /** 向该沙盒发送 Bridge 指令。 */
  send: (message: ShellOutgoingPayload) => void
  /** 把状态补丁转发给该沙盒。 */
  forwardState: (seq: number, ops: JsonPatchOp[]) => void
}

type CapturePreview = (signal: AbortSignal) => Promise<Blob>

/** 试玩有自己的输入和导航，不能调用设计视图的选区、批注或直改操作。 */
export type BoardFramePurpose =
  | { type: 'overview'; interactive: boolean; animate?: boolean }
  | { type: 'focus' }
  | { type: 'play'; onNavigate: (target: string) => void; onExit: () => void }

interface ArtifactFrameProps {
  artifact: Artifact
  version: VersionSummary
  board: LoadedCanvasBoard
  state: StateStreamSnapshot
  /** 当前版本的浏览会话，不向历史、导出或其他画板转发。 */
  tweakPreviews: BoardTweakPreviewStore
  useTweakPreview: boolean
  sandboxOrigin: string
  pins: readonly Feedback[]
  /** 图钉只打开原线程，不覆盖正在撰写的选区。 */
  onFocusPin: (feedback: Feedback) => void
  purpose: BoardFramePurpose
  /** 只有设计视图登记；试玩不接收设计视图的指认或编辑指令。 */
  register?: (id: string, frame: FrameConnection | null) => void
  /** 仅 scoped 总览上报首绘；参数处于默认值时才提供截图回调。 */
  onReady?: (boardId: string, capture?: CapturePreview) => void
  onCapabilities: (
    id: string,
    version: number,
    capabilities: { playable?: boolean; animated?: boolean },
  ) => void
  watchLayers: boolean
  onLayers: (id: string, version: number, layers: CanvasLayer[], truncated: boolean) => void
  /** 仅把当前设计帧的命中回报交给工作区；请求标识由工作区核对。 */
  onElementTarget: (
    boardId: string,
    message: Extract<SandboxToShellMessage, { type: 'inspect.target' }>,
  ) => void
  /** 直改模式下沙盒上报选中元素时调用。 */
  onVisualSelect: (message: Extract<SandboxToShellMessage, { type: 'visual.select' }>) => void
}

interface PendingPreview {
  requestId: string
  version: number
  accept: (png: Blob) => void
  reject: (reason: unknown) => void
}

const PREVIEW_CAPTURE_TIMEOUT = 10_000

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

function frameViewKey(artifactId: string, id: string, scoped: boolean, focused: boolean) {
  if (focused) return JSON.stringify([artifactId, id, 'focus'])
  return scoped ? JSON.stringify([artifactId, id]) : artifactId
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
  tweakPreviews,
  useTweakPreview,
  sandboxOrigin,
  pins,
  onFocusPin,
  purpose,
  register,
  onReady,
  onCapabilities,
  watchLayers,
  onLayers,
  onElementTarget,
  onVisualSelect,
}: ArtifactFrameProps) {
  const artifactId = artifact.publicId
  const { id, scoped, source, type, designLayers, appearance, tweaks } = board
  const versionNumber = version.version
  const playback = purpose.type === 'play'
  const focused = purpose.type === 'focus'
  const isolated = focused || playback
  const interactive = playback || (purpose.type === 'overview' && purpose.interactive)
  const scopedOverview = scoped && purpose.type === 'overview'
  const overviewAnimation =
    scoped && !playback ? purpose.type === 'overview' && purpose.animate !== false : undefined
  const purposeType = purpose.type
  const viewKey = frameViewKey(artifactId, id, scoped, focused)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const lastStateSeq = useRef(-1)
  const hadSelection = useRef(false)
  const renderSequence = useRef(0)
  const captureSequence = useRef(0)
  const captureControl = useRef<{
    cancel: (reason: string) => void
    invalidate: (reason: string) => void
  } | null>(null)
  const { nonce, host } = useMemo(() => {
    // 画板作用域或查看方式改变时重新握手；总览内的动画开关不影响会话。
    void artifactId
    void id
    void scoped
    void purposeType
    const nonce = createBridgeNonce()
    return {
      nonce,
      host: new SandboxBridgeHost({
        nonce,
        sandboxOrigin,
        getIframeWindow: () => iframeRef.current?.contentWindow ?? null,
      }),
    }
  }, [artifactId, id, scoped, sandboxOrigin, purposeType])
  const iframeSrc = useMemo(() => {
    const shellOrigin =
      typeof window !== 'undefined' && window.location.origin !== 'null'
        ? window.location.origin
        : 'http://127.0.0.1:24321'
    return buildSandboxIframeUrl(sandboxOrigin, nonce, shellOrigin)
  }, [sandboxOrigin, nonce])

  const [error, setError] = useState<SandboxErrorRecord | null>(null)
  const [livePinRects, setLivePinRects] = useState<Record<string, ElementRect | null>>({})
  const selection = useSelectionStore((s) => selectionForVersion(s, artifactId, versionNumber))
  const selected =
    !playback && selection && belongsToBoard(selection, id, scoped) ? selection : null
  const focusedFeedbackId = useSelectionStore((s) => s.focusedFeedbackId)
  const versionPins = useMemo(
    () => pins.filter((pin) => pin.element && belongsToBoard(pin.element, id, scoped)),
    [pins, id, scoped],
  )
  const overrides = useStore(tweakPreviews, (state) =>
    useTweakPreview && tweaks?.length ? state.byBoard.get(id) : undefined,
  )
  const boardTweaks = useMemo(
    () => (tweaks?.length ? resolveArtboardTweaks(tweaks) : undefined),
    [tweaks],
  )
  const tweakPreview = useMemo(
    () => (tweaks && overrides ? resolveArtboardTweaks(tweaks, overrides) : undefined),
    [tweaks, overrides],
  )
  const render = useMemo(
    () => ({
      artifactType: type,
      version: versionNumber,
      source,
      designLayers,
      boardAppearance: appearance,
      boardTweaks,
      boardId: scoped ? id : undefined,
      playback: playback ? (true as const) : undefined,
    }),
    [type, source, versionNumber, scoped, id, playback, designLayers, appearance, boardTweaks],
  )
  const applied = useRef<{
    render: typeof render
    renderId: number | undefined
    overviewAnimation: boolean | undefined
    tweakPreview: typeof tweakPreview
    pins: readonly Feedback[]
    watchingLayers: boolean
  } | null>(null)
  const latest = useRef({
    nonce,
    render,
    state,
    versionNumber,
    versionPins,
    interactive,
    onVisualSelect,
    purpose,
    board,
    onReady,
    tweakPreview,
    onCapabilities,
    watchLayers,
    onLayers,
    onElementTarget,
  })
  latest.current = {
    nonce,
    render,
    state,
    versionNumber,
    versionPins,
    interactive,
    onVisualSelect,
    purpose,
    board,
    onReady,
    tweakPreview,
    onCapabilities,
    watchLayers,
    onLayers,
    onElementTarget,
  }

  useEffect(() => {
    applied.current = null
    lastStateSeq.current = -1
    const storage = createStorageRelay(artifactId, host)
    let connected = true
    let renderedId: number | undefined
    let pending: PendingPreview | null = null
    const cancelCapture = (reason: string) => {
      if (!pending) return
      if (connected) host.send({ type: 'capture.cancel', requestId: pending.requestId })
      pending.reject(new Error(reason))
    }
    const invalidateCapture = (reason: string) => {
      renderedId = undefined
      cancelCapture(reason)
    }
    captureControl.current = { cancel: cancelCapture, invalidate: invalidateCapture }

    const capturePreview = (renderId: number, signal: AbortSignal): Promise<Blob> => {
      if (signal.aborted) return Promise.reject(signal.reason)
      const current = applied.current
      if (
        !connected ||
        latest.current.nonce !== nonce ||
        !iframeRef.current?.contentWindow ||
        renderedId !== renderId ||
        current?.renderId !== renderedId ||
        current.render !== latest.current.render
      ) {
        return Promise.reject(new Error('画板尚未完成渲染'))
      }
      if (current.tweakPreview !== undefined || latest.current.tweakPreview !== undefined) {
        return Promise.reject(new Error('画板正在预览临时参数'))
      }
      if (pending) return Promise.reject(new Error('画板正在生成预览'))

      const { width, height } = latest.current.board
      const version = current.render.version
      const scale = Math.min(1, CANVAS_PREVIEW_MAX_EDGE / Math.max(width, height))
      const requestId = String(++captureSequence.current)
      const { promise, resolve, reject } = Promise.withResolvers<Blob>()
      let checking = false
      const finish = () => {
        if (pending !== request) return false
        pending = null
        window.clearTimeout(timeout)
        signal.removeEventListener('abort', abort)
        return true
      }
      const abort = () => {
        if (checking) request.reject(signal.reason)
        else host.send({ type: 'capture.cancel', requestId })
      }
      const request: PendingPreview = {
        requestId,
        version,
        accept(png) {
          if (checking) return
          checking = true
          void verifyPreviewPng(png, Math.round(width * scale), Math.round(height * scale)).then(
            () => {
              if (signal.aborted) {
                request.reject(signal.reason)
              } else if (
                latest.current.nonce !== nonce ||
                !iframeRef.current?.contentWindow ||
                current.render !== latest.current.render ||
                renderedId !== renderId ||
                latest.current.tweakPreview !== undefined
              ) {
                request.reject(new Error('画板已重新渲染'))
              } else if (finish()) {
                resolve(png)
              }
            },
            request.reject,
          )
        },
        reject(reason) {
          if (finish()) reject(reason)
        },
      }
      pending = request
      const timeout = window.setTimeout(() => {
        host.send({ type: 'capture.cancel', requestId })
        request.reject(new DOMException('生成画板预览超时', 'TimeoutError'))
      }, PREVIEW_CAPTURE_TIMEOUT)
      signal.addEventListener('abort', abort, { once: true })
      try {
        host.send({ type: 'capture.png', requestId, version, width, height, scale })
      } catch (error) {
        request.reject(error)
      }
      return promise
    }

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
      // 切开已保存画板与直改的乐观 DOM，旧捕获不能作为保存版本的缩略图。
      if (scopedOverview && message.type === 'apply.preview') {
        invalidateCapture('画板正在预览未保存的变更')
      }
      host.send(message)
    }
    const off = host.onMessage((message) => {
      const activeVersion = latest.current.versionNumber
      const selectionStore = useSelectionStore.getState()
      switch (message.type) {
        case 'ready':
          invalidateCapture('画板沙盒已重新连接')
          // Bridge 已按顺序发出 render；握手前只保留最后一次覆写。
          if (scoped && latest.current.tweakPreview) {
            host.send({
              type: 'board.tweaks.preview',
              boardId: id,
              version: activeVersion,
              values: latest.current.tweakPreview,
            })
          }
          break
        case 'capture.png.result':
        case 'capture.png.failure':
          if (
            pending &&
            pending.requestId === message.requestId &&
            pending.version === message.version
          ) {
            if (message.type === 'capture.png.result') pending.accept(message.png)
            else pending.reject(new Error(message.message))
          }
          break
        case 'viewState.snapshot':
          if (!playback) useWorkspaceStore.getState().setPreservedView(viewKey, message.state)
          break
        case 'error':
          invalidateCapture(message.message)
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
          const current = applied.current
          if (
            message.renderId !== undefined &&
            (current?.renderId !== message.renderId || current.render !== latest.current.render)
          ) {
            break
          }
          setError(null)
          if (playback) break
          latest.current.onCapabilities(id, activeVersion, {
            playable: message.playable === true,
            animated: message.animated,
          })
          const currentSelection = selectionForVersion(selectionStore, artifactId, activeVersion)
          const layer = selectionStore.layersByArtifact[artifactId]
          if (currentSelection) {
            send({ type: 'highlight', element: currentSelection, ...(layer ? { layer } : {}) })
          }
          trackPins(host, latest.current.versionPins)
          if (scopedOverview && message.renderId !== undefined) {
            const readyRenderId = message.renderId
            const firstReady = renderedId !== readyRenderId
            renderedId = readyRenderId
            if (latest.current.tweakPreview === undefined && current?.tweakPreview === undefined) {
              // 重置后给调度器新的回调，取消中的旧请求不会清掉新安排。
              latest.current.onReady?.(id, (signal) => capturePreview(readyRenderId, signal))
            } else if (firstReady) {
              latest.current.onReady?.(id)
            }
          }
          break
        }
        case 'inspect.layers.snapshot':
          if (!isolated && latest.current.watchLayers && message.version === activeVersion) {
            latest.current.onLayers(id, activeVersion, message.layers, message.truncated)
          }
          break
        case 'inspect.target':
          if (!isolated && message.version === activeVersion) {
            const element = message.element
              ? bindSandboxReference(message.element, latest.current.board)
              : null
            latest.current.onElementTarget(id, { ...message, element })
          }
          break
        case 'inspect.select': {
          if (isolated) break
          if (message.version !== undefined && message.version !== activeVersion) break
          const element = bindSandboxReference(message.element, latest.current.board)
          if (!element) break
          const currentSelection = selectionForVersion(selectionStore, artifactId, activeVersion)
          const layer = selectionStore.layersByArtifact[artifactId]
          if (!currentSelection || !belongsToBoard(currentSelection, id, scoped)) break
          if (layer && (layer.id !== message.layerId || message.version !== activeVersion)) break
          // 重排后只跟踪同一个节点的新坐标，不改变批注归属。
          selectionStore.setSelectedElement(
            artifactId,
            {
              ...currentSelection,
              ...(layer && message.layerSelector ? { selector: message.layerSelector } : {}),
              rect: element.rect,
            },
            layer,
          )
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
              error: '画板查看和交互预览不能修改作品存储',
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
            latest.current.onCapabilities(id, activeVersion, { playable: message.playable })
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
      connected = false
      invalidateCapture('画板沙盒已断开')
      captureControl.current = null
      register?.(id, null)
      storage.dispose()
      off()
      host.stop()
    }
  }, [artifactId, id, scoped, isolated, playback, viewKey, host, nonce, register, scopedOverview])

  // 未 ready 的新 render 会替换队列；重新下发属于该帧的图层和图钉订阅。
  useEffect(() => {
    const previous = applied.current
    const needsRender = previous?.render !== render
    let renderId = previous?.renderId
    if (needsRender) {
      captureControl.current?.invalidate('画板已重新渲染')
      renderId = scopedOverview ? ++renderSequence.current : undefined
      const currentState = latest.current.state
      const preservedState = playback
        ? undefined
        : useWorkspaceStore.getState().preservedViewByArtifact[viewKey]
      host.send({
        type: 'render',
        ...render,
        state: currentState.snapshot,
        ...(overviewAnimation !== undefined ? { overviewAnimation, renderId } : {}),
        ...(preservedState ? { preservedState } : {}),
      })
      lastStateSeq.current = currentState.seq
      setError((current) => (current?.version === versionNumber ? current : null))
      setLivePinRects({})
    } else if (
      overviewAnimation !== undefined &&
      overviewAnimation !== previous?.overviewAnimation
    ) {
      host.send({ type: 'animation.set', version: versionNumber, animate: overviewAnimation })
    }
    if (
      scoped &&
      boardTweaks &&
      host.isReady() &&
      ((needsRender && tweakPreview !== undefined) || previous?.tweakPreview !== tweakPreview)
    ) {
      if (tweakPreview !== undefined) {
        captureControl.current?.cancel('画板正在预览临时参数')
      }
      host.send({
        type: 'board.tweaks.preview',
        boardId: id,
        version: versionNumber,
        values: tweakPreview ?? boardTweaks,
      })
    }
    const watchingLayers = !isolated && watchLayers
    if ((needsRender && watchingLayers) || watchingLayers !== (previous?.watchingLayers ?? false)) {
      host.send({ type: 'inspect.layers.watch', active: watchingLayers })
    }
    if (!playback && (needsRender || previous?.pins !== versionPins)) trackPins(host, versionPins)
    applied.current = {
      render,
      renderId,
      overviewAnimation,
      tweakPreview,
      pins: versionPins,
      watchingLayers,
    }
  }, [
    boardTweaks,
    host,
    id,
    isolated,
    overviewAnimation,
    playback,
    render,
    scoped,
    scopedOverview,
    tweakPreview,
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
        title={`画板内容：${board.title}`}
        src={iframeSrc}
        width={board.width}
        height={board.height}
        sandbox={SANDBOX_IFRAME_SANDBOX_ATTR}
        referrerPolicy="no-referrer"
        inert={!interactive}
        tabIndex={interactive && (playback || !scoped) ? undefined : -1}
        className={`block h-full w-full border-0 bg-white ${interactive ? 'pointer-events-auto' : 'pointer-events-none'}`}
      />
      {!playback && (
        <ElementOverlay
          selected={selected}
          pins={versionPins}
          livePinRects={livePinRects}
          focusedFeedbackId={focusedFeedbackId}
          onSelectPin={onFocusPin}
        />
      )}
      {error?.version === versionNumber && (
        <div className="pointer-events-auto absolute inset-x-0 bottom-0 z-20 max-h-full overflow-auto p-2">
          {playback && (
            <p role="alert" className="rounded border border-border bg-surface p-3 text-sm">
              无法播放原型：{error.message}
            </p>
          )}
          {!playback && (
            <RuntimeErrorPanel
              artifactId={scoped ? viewKey : artifactId}
              projectId={artifact.projectId}
              version={versionNumber}
              source={source}
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
      )}
    </div>
  )
}

function trackPins(host: SandboxBridgeHost, pins: readonly Feedback[]): void {
  host.send({
    type: 'pins.track',
    pins: pins.flatMap((pin) => (pin.element ? [{ id: pin.id, element: pin.element }] : [])),
  })
}

async function verifyPreviewPng(png: Blob, width: number, height: number): Promise<void> {
  const header = new DataView(await png.slice(0, 24).arrayBuffer())
  if (
    header.byteLength !== 24 ||
    header.getUint32(0) !== 0x89504e47 ||
    header.getUint32(4) !== 0x0d0a1a0a ||
    header.getUint32(12) !== 0x49484452 ||
    header.getUint32(16) !== width ||
    header.getUint32(20) !== height
  ) {
    throw new Error('沙盒返回的预览 PNG 格式或尺寸不符')
  }
}
