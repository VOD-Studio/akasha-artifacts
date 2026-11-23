import type { ArtifactType, PreservedViewState } from '@akasha/protocol'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { SandboxBridgeClient } from './bridge/client'
import { captureSandboxPng } from './capture-png'
import { SandboxInspector } from './inspector/index'
import { bindPrototype, hasPlayableControls } from './prototype'
import { registerBuiltinRenderers } from './renderers/builtins'
import { getRenderer } from './renderers/registry'
import {
  defaultPreservedStateManager,
  PreservedStateContext,
  type PreservedStateManager,
} from './state/preserve'
import {
  ArtifactStateContext,
  type ArtifactStateStore,
  defaultArtifactStateStore,
} from './state/store'
import { SandboxVisualInspector } from './visual-edit'

registerBuiltinRenderers()

/** 一次渲染指令：按类型与版本渲染这份源码。 */
export interface RenderPayload {
  artifactType: ArtifactType
  /** HTML 画板的 id；给出时整段源码作为一个画板块渲染。 */
  boardId?: string
  version: number
  source: string
  /** 允许由制品的控件发出原型导航请求。 */
  playback?: true
}

/** 沙盒根组件的输入；多数字段用于测试或独立运行时预置。 */
export interface SandboxAppProps {
  /** 为空时沙盒独立运行，不与外壳通信。 */
  bridge?: SandboxBridgeClient | null
  stateStore?: ArtifactStateStore
  preserved?: PreservedStateManager
  /** 预置的首个渲染指令；正常由外壳经 Bridge 下发。 */
  initialRender?: RenderPayload | null
  /** 预置的初始状态快照。 */
  initialState?: Record<string, unknown>
  /** 预置的保态快照。 */
  initialPreservedState?: PreservedViewState
}

/** 沙盒根组件：接收外壳的渲染与状态指令，并把运行错误、选中元素与尺寸回报给外壳。 */
export function SandboxApp({
  bridge,
  stateStore = defaultArtifactStateStore,
  preserved = defaultPreservedStateManager,
  initialRender = null,
  initialState,
  initialPreservedState,
}: SandboxAppProps) {
  const [payload, setPayload] = useState<RenderPayload | null>(initialRender)
  const committedPayloadRef = useRef<RenderPayload | null>(initialRender)
  const renderedVisualVersionRef = useRef(0)
  const lastPlayable = useRef<boolean | undefined>(undefined)
  const rootRef = useRef<HTMLDivElement>(null)
  const inspectorRef = useRef<SandboxInspector | null>(null)
  const versionRef = useRef<number>(initialRender?.version ?? 0)
  versionRef.current = payload?.version ?? 0

  useEffect(() => {
    if (initialState) stateStore.replace(initialState)
  }, [initialState, stateStore])

  useEffect(() => {
    if (initialPreservedState) preserved.hydrate(initialPreservedState)
  }, [initialPreservedState, preserved])

  // 订阅外壳经 Bridge 发来的 render 与增量 state 补丁（state 仅更新 store，绝不触发外层重挂载）
  useEffect(() => {
    if (!bridge) return
    preserved.setSnapshotReporter((snapshot) => {
      bridge.send({ type: 'viewState.snapshot', state: snapshot })
    })

    const inspector = new SandboxInspector(() => rootRef.current, bridge)
    inspectorRef.current = inspector
    const visualInspector = new SandboxVisualInspector(
      () => rootRef.current,
      bridge,
      () => renderedVisualVersionRef.current,
    )

    let capturing = false
    const off = bridge.onMessage((msg) => {
      if (msg.type === 'render') {
        renderedVisualVersionRef.current = 0
        lastPlayable.current = undefined
        stateStore.replace(msg.state)
        preserved.hydrate(msg.preservedState)
        const next: RenderPayload = {
          artifactType: msg.artifactType,
          version: msg.version,
          source: msg.source,
          ...(msg.artifactType === 'html' && msg.boardId ? { boardId: msg.boardId } : {}),
          ...(msg.playback ? { playback: true } : {}),
        }
        committedPayloadRef.current = next
        setPayload(next)
      } else if (msg.type === 'capture.png') {
        const root = rootRef.current
        if (!root || capturing || msg.version !== renderedVisualVersionRef.current) return
        capturing = true
        void captureSandboxPng(root, msg.width, msg.height, msg.scale)
          .then((png) => {
            if (png.size > 32 * 1024 * 1024) throw new Error('画板 PNG 超出传输上限')
            bridge.send({ type: 'capture.png.result', version: msg.version, png })
          })
          .catch((error: unknown) =>
            bridge.send({
              type: 'capture.png.failure',
              version: msg.version,
              message: error instanceof Error && error.message ? error.message : '画板不能生成 PNG',
            }),
          )
          .finally(() => {
            capturing = false
          })
      } else if (msg.type === 'apply.preview') {
        const committed = committedPayloadRef.current
        if (committed?.version === msg.version) setPayload({ ...committed, source: msg.source })
      } else if (msg.type === 'apply.rollback') {
        const committed = committedPayloadRef.current
        if (committed?.version === msg.version) setPayload(committed)
      } else if (msg.type === 'visual.inspect') {
        visualInspector.setActive(msg.active)
      } else if (msg.type === 'state') {
        try {
          stateStore.applyPatch(msg.seq, msg.ops)
        } catch (err) {
          bridge.send({
            type: 'error',
            phase: 'runtime',
            message: err instanceof Error ? err.message : String(err),
          })
        }
      } else if (msg.type === 'inspect.start') {
        inspector.startInspecting()
      } else if (msg.type === 'inspect.stop') {
        inspector.stopInspecting()
      } else if (msg.type === 'highlight') {
        inspector.highlight(msg.element)
      } else if (msg.type === 'pins.track') {
        inspector.trackPins(msg.pins)
      }
    })

    bridge.start()

    const handleWindowError = (event: ErrorEvent) => {
      // 浏览器 window.error 的 lineno/colno 指向编译后的 blob JS，而非原始 TSX 源码，
      // 因此运行时未映射异常不伪造原始源码 loc，避免外壳高亮错误行。
      bridge.send({
        type: 'error',
        phase: 'runtime',
        message: event.message || '未知运行时异常',
        stack: event.error instanceof Error ? event.error.stack : undefined,
      })
    }

    const handleRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason
      bridge.send({
        type: 'error',
        phase: 'runtime',
        message: reason instanceof Error ? reason.message : String(reason),
        stack: reason instanceof Error ? reason.stack : undefined,
      })
    }

    window.addEventListener('error', handleWindowError)
    window.addEventListener('unhandledrejection', handleRejection)

    return () => {
      inspector.dispose()
      visualInspector.dispose()
      inspectorRef.current = null
      off()
      preserved.setSnapshotReporter(undefined)
      window.removeEventListener('error', handleWindowError)
      window.removeEventListener('unhandledrejection', handleRejection)
      bridge.stop()
    }
  }, [bridge, stateStore, preserved])

  const playbackVersion = payload?.playback ? payload.version : 0
  useEffect(() => {
    if (!bridge || !playbackVersion || !rootRef.current) return
    return bindPrototype(rootRef.current, {
      navigate: (target) =>
        bridge.send({ type: 'prototype.navigate', version: playbackVersion, target }),
      exit: () => bridge.send({ type: 'prototype.exit', version: playbackVersion }),
    })
  }, [bridge, playbackVersion])

  const supportsPrototype = payload?.artifactType === 'html' || payload?.artifactType === 'react'
  useEffect(() => {
    const root = rootRef.current
    if (!bridge || !root || !supportsPrototype || playbackVersion) return
    const observer = new MutationObserver(() => {
      const version = renderedVisualVersionRef.current
      if (!version || version !== versionRef.current) return
      const playable = hasPlayableControls(root)
      if (lastPlayable.current === playable) return
      lastPlayable.current = playable
      bridge.send({ type: 'prototype.availability', version, playable })
    })
    observer.observe(root, {
      subtree: true,
      childList: true,
      attributeFilter: [
        'aria-disabled',
        'aria-hidden',
        'class',
        'contenteditable',
        'data-ak-next',
        'disabled',
        'hidden',
        'href',
        'inert',
        'readonly',
        'role',
        'style',
        'tabindex',
        'type',
      ],
    })
    return () => observer.disconnect()
  }, [bridge, playbackVersion, supportsPrototype])

  // 自动向外壳上报容器尺寸变化，便于外壳自适应高度或视口定位
  useEffect(() => {
    if (!bridge || !rootRef.current || typeof ResizeObserver === 'undefined') return
    const el = rootRef.current
    const observer = new ResizeObserver((entries) => {
      const entry = entries.at(-1)
      if (!entry) return
      bridge.send({
        type: 'resize',
        width: Math.max(0, Math.round(entry.contentRect.width)),
        height: Math.max(0, Math.round(entry.contentRect.height)),
      })
      // 容器回流（例如外壳侧边面板展开/收起导致宽度变化）时同步刷新选中框与图钉坐标
      inspectorRef.current?.syncRects()
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [bridge])

  const handleError = useCallback(
    (err: { phase: 'compile' | 'runtime'; message: string; stack?: string; loc?: string }) => {
      bridge?.send({
        type: 'error',
        phase: err.phase,
        message: err.message,
        ...(err.stack ? { stack: err.stack } : {}),
        ...(err.loc ? { loc: err.loc } : {}),
      })
    },
    [bridge],
  )

  const handleRendered = useCallback(
    (version?: number) => {
      const ver = version ?? versionRef.current
      // 旧 DOM 仍显示时，不让直改用旧坐标修改新源码。
      if (!bridge || ver < 1 || ver !== versionRef.current) return
      renderedVisualVersionRef.current = ver
      const height = rootRef.current
        ? Math.max(0, Math.round(rootRef.current.scrollHeight))
        : undefined
      lastPlayable.current = rootRef.current ? hasPlayableControls(rootRef.current) : false
      bridge.send({
        type: 'rendered',
        version: ver,
        playable: lastPlayable.current,
        ...(height !== undefined ? { height } : {}),
      })
    },
    [bridge],
  )

  const renderer = useMemo(
    () => (payload ? getRenderer(payload.artifactType) : undefined),
    [payload],
  )

  return (
    <ArtifactStateContext.Provider value={stateStore}>
      <PreservedStateContext.Provider value={preserved}>
        <div ref={rootRef} className="min-h-screen bg-white text-slate-900">
          {payload ? (
            renderer ? (
              renderer({
                source: payload.source,
                ...(payload.artifactType === 'html' && payload.boardId
                  ? { boardId: payload.boardId }
                  : {}),
                version: payload.version,
                stateStore,
                preserved,
                onError: handleError,
                onRendered: handleRendered,
                onRequestAnnotation: bridge
                  ? (element) =>
                      bridge.send({ type: 'annotation.request', element, version: payload.version })
                  : undefined,
              })
            ) : (
              <div className="p-6 text-sm text-amber-700">
                暂不支持的 Artifact 类型：{payload.artifactType}
              </div>
            )
          ) : (
            <div className="flex min-h-screen items-center justify-center p-6 text-xs text-slate-400">
              Akasha Sandbox 已就绪，等待外壳下发渲染内容…
            </div>
          )}
        </div>
      </PreservedStateContext.Provider>
    </ArtifactStateContext.Provider>
  )
}
