import {
  type ArtboardAppearance,
  type ArtboardTweakValues,
  type ArtifactType,
  CANVAS_PREVIEW_MAX_EDGE,
  type DesignLayer,
  type PreservedViewState,
} from '@akasha/protocol'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { SandboxBridgeClient } from './bridge/client'
import { captureSandboxPng } from './capture-png'
import { SandboxInspector } from './inspector/index'
import { readCanvasLayers } from './inspector/layers'
import {
  hasOverviewMotion,
  loopOverviewMotion,
  type OverviewMotion,
  pauseOverviewMotion,
} from './overview-motion'
import { bindPrototype, hasPlayableControls } from './prototype'
import { artboardStyle } from './renderers/artboard-style'
import { registerBuiltinRenderers } from './renderers/builtins'
import { DesignLayerScene } from './renderers/DesignLayerScene'
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
  /** 同一 scoped 总览会话的渲染编号。 */
  renderId?: number
  source: string
  designLayers?: DesignLayer[]
  /** 仅 `boardId` 所属的持久外观与参数，不包含临时覆写。 */
  boardAppearance?: ArtboardAppearance
  boardTweaks?: ArtboardTweakValues
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
  const [tweakPreview, setTweakPreview] = useState<{ values?: ArtboardTweakValues }>()
  const requestedTweakPreview = useRef(false)
  const paintedTweakPreview = useRef(false)
  const committedPayloadRef = useRef<RenderPayload | null>(initialRender)
  const renderedVisualVersionRef = useRef(0)
  const renderedOverviewRef = useRef<RenderPayload | null>(null)
  const syncOverviewMotion = useRef<(() => void) | null>(null)
  const [watchLayers, setWatchLayers] = useState(false)
  const refreshLayers = useRef<(() => void) | null>(null)
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

    const inspector = new SandboxInspector(
      () => rootRef.current,
      bridge,
      () => renderedVisualVersionRef.current,
    )
    inspectorRef.current = inspector
    const visualInspector = new SandboxVisualInspector(
      () => rootRef.current,
      bridge,
      () => renderedVisualVersionRef.current,
    )

    let capture: { requestId?: string; controller: AbortController } | null = null
    let overviewVersion: number | undefined
    let looping: OverviewMotion | undefined
    let paused: OverviewMotion | undefined
    const releaseMotion = () => {
      paused?.resume()
      looping?.resume()
      paused = undefined
      looping = undefined
    }
    const setOverviewAnimation = (animate: boolean) => {
      const root = rootRef.current
      if (!root) return
      if (animate) {
        looping ??= loopOverviewMotion(root)
        paused?.resume()
        paused = undefined
      } else {
        // 保留循环的相位，避免把已循环一轮的 CSS 动画恢复为「已结束」。
        paused ??= pauseOverviewMotion(root)
      }
      looping?.sync()
    }
    syncOverviewMotion.current = () => {
      paused?.sync()
      looping?.sync()
    }
    const off = bridge.onMessage((msg) => {
      if (msg.type === 'render') {
        capture?.controller.abort()
        renderedVisualVersionRef.current = 0
        lastPlayable.current = undefined
        overviewVersion =
          msg.artifactType === 'html' &&
          msg.boardId &&
          !msg.playback &&
          msg.overviewAnimation !== undefined
            ? msg.version
            : undefined
        releaseMotion()
        if (overviewVersion !== undefined) setOverviewAnimation(msg.overviewAnimation === true)
        stateStore.replace(msg.state)
        preserved.hydrate(msg.preservedState)
        const next: RenderPayload = {
          artifactType: msg.artifactType,
          version: msg.version,
          source: msg.source,
          ...(overviewVersion !== undefined && msg.renderId !== undefined
            ? { renderId: msg.renderId }
            : {}),
          ...(msg.artifactType === 'html' && msg.boardId
            ? {
                boardId: msg.boardId,
                designLayers: msg.designLayers,
                boardAppearance: msg.boardAppearance,
                boardTweaks: msg.boardTweaks,
              }
            : {}),
          ...(msg.playback ? { playback: true } : {}),
        }
        committedPayloadRef.current = next
        setPayload(next)
        requestedTweakPreview.current = false
        setTweakPreview(undefined)
      } else if (msg.type === 'animation.set') {
        if (msg.version === overviewVersion) setOverviewAnimation(msg.animate)
      } else if (msg.type === 'board.tweaks.preview') {
        const committed = committedPayloadRef.current
        if (
          committed?.boardTweaks &&
          committed.boardId === msg.boardId &&
          committed.version === msg.version
        ) {
          const defaults = committed.boardTweaks
          const entries = Object.entries(msg.values)
          const isPreview =
            entries.length !== Object.keys(defaults).length ||
            entries.some(([key, value]) => defaults[key] !== value)
          requestedTweakPreview.current = isPreview
          if (isPreview) capture?.controller.abort()
          setTweakPreview(isPreview ? { values: msg.values } : {})
        }
      } else if (msg.type === 'capture.cancel') {
        if (capture && capture.requestId === msg.requestId) capture.controller.abort()
      } else if (msg.type === 'capture.png') {
        const { requestId, version, width, height, scale } = msg
        const root = rootRef.current
        const correlation = requestId === undefined ? { version } : { version, requestId }
        const failure = (message: string) => {
          bridge.send({ type: 'capture.png.failure', ...correlation, message })
        }
        if (!root || capture || version !== renderedVisualVersionRef.current) {
          if (requestId !== undefined) failure(capture ? '画板正在生成 PNG' : '画板尚未渲染')
          return
        }
        // Bridge 消息可先于 React 提交到达；请求值和已经绘制的值都须是默认值。
        if (requestedTweakPreview.current || paintedTweakPreview.current) {
          failure('画板正在预览临时参数')
          return
        }
        if (
          requestId !== undefined &&
          (version !== overviewVersion ||
            renderedOverviewRef.current !== committedPayloadRef.current ||
            Math.round(Math.max(width, height) * scale) > CANVAS_PREVIEW_MAX_EDGE)
        ) {
          failure('画板无法生成当前版本的预览')
          return
        }
        const controller = new AbortController()
        capture = { requestId, controller }
        void captureSandboxPng(root, width, height, scale, controller.signal)
          .then((png) => {
            controller.signal.throwIfAborted()
            if (png.size > 32 * 1024 * 1024) throw new Error('画板 PNG 超出传输上限')
            bridge.send({ type: 'capture.png.result', ...correlation, png })
          })
          .catch((error: unknown) => {
            if (controller.signal.aborted) {
              failure('已取消预览')
              return
            }
            failure(error instanceof Error && error.message ? error.message : '画板不能生成 PNG')
          })
          .finally(() => {
            capture = null
          })
      } else if (msg.type === 'apply.preview') {
        const committed = committedPayloadRef.current
        if (committed?.version === msg.version) {
          capture?.controller.abort()
          renderedOverviewRef.current = null
          setPayload({ ...committed, source: msg.source })
        }
      } else if (msg.type === 'apply.rollback') {
        const committed = committedPayloadRef.current
        if (committed?.version === msg.version) setPayload(committed)
      } else if (msg.type === 'inspect.at' && !committedPayloadRef.current?.playback) {
        inspector.inspectAt(msg)
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
      } else if (msg.type === 'inspect.layers.watch') {
        setWatchLayers(msg.active)
      } else if (msg.type === 'highlight') {
        inspector.highlight(msg.element, msg.reveal, msg.layer)
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
      capture?.controller.abort()
      releaseMotion()
      syncOverviewMotion.current = null
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
  const strictControls = payload?.artifactType === 'html'
  useEffect(() => {
    const root = rootRef.current
    if (!bridge || !root || !supportsPrototype || playbackVersion) return
    const observer = new MutationObserver(() => {
      const version = renderedVisualVersionRef.current
      if (!version || version !== versionRef.current) return
      const playable = hasPlayableControls(root, { scoped: strictControls })
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
        'form',
        'hidden',
        'href',
        'id',
        'inert',
        'open',
        'popover',
        'popovertarget',
        'readonly',
        'role',
        'style',
        'tabindex',
        'type',
      ],
    })
    return () => observer.disconnect()
  }, [bridge, playbackVersion, supportsPrototype, strictControls])

  useEffect(() => {
    const root = rootRef.current
    if (!bridge || !root || !watchLayers || playbackVersion) return
    let pending: number | undefined
    const schedule = () => {
      if (pending !== undefined) return
      // 把一次 DOM 更新的多个 mutation 合并，限制动画或图表持续变化时的桥流量。
      pending = window.setTimeout(() => {
        pending = undefined
        const version = renderedVisualVersionRef.current
        if (!version || version !== versionRef.current) return
        bridge.send({ type: 'inspect.layers.snapshot', version, ...readCanvasLayers(root) })
      }, 100)
    }
    refreshLayers.current = schedule
    const observer = new MutationObserver(schedule)
    observer.observe(root, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
    })
    schedule()
    return () => {
      refreshLayers.current = null
      observer.disconnect()
      window.clearTimeout(pending)
    }
  }, [bridge, playbackVersion, watchLayers])

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
      refreshLayers.current?.()
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
      if (
        !bridge ||
        ver < 1 ||
        ver !== versionRef.current ||
        payload?.renderId !== committedPayloadRef.current?.renderId
      ) {
        return
      }
      syncOverviewMotion.current?.()
      const renderId = payload === committedPayloadRef.current ? payload?.renderId : undefined
      if (renderId !== undefined) renderedOverviewRef.current = payload
      renderedVisualVersionRef.current = ver
      const root = rootRef.current
      const height = root ? Math.max(0, Math.round(root.scrollHeight)) : undefined
      lastPlayable.current =
        root && !payload?.playback
          ? hasPlayableControls(root, { scoped: payload?.artifactType === 'html' })
          : false
      const animated =
        root && payload?.boardId && !payload.playback ? hasOverviewMotion(root) : undefined
      bridge.send({
        type: 'rendered',
        version: ver,
        ...(renderId !== undefined ? { renderId } : {}),
        playable: lastPlayable.current,
        ...(animated === undefined ? {} : { animated }),
        ...(height !== undefined ? { height } : {}),
      })
      refreshLayers.current?.()
    },
    [bridge, payload],
  )

  useLayoutEffect(() => {
    paintedTweakPreview.current = tweakPreview?.values !== undefined
    // 重置参数不重新挂载作者内容；默认样式提交后，重新允许总览安排截图。
    if (
      tweakPreview &&
      !paintedTweakPreview.current &&
      !requestedTweakPreview.current &&
      renderedOverviewRef.current === payload &&
      payload?.renderId !== undefined
    ) {
      handleRendered(payload.version)
    }
  }, [handleRendered, payload, tweakPreview])

  // 原生图层变动但 HTML 片段未变时，HTML 渲染器不会再次挂载或上报。
  useEffect(() => {
    const previous = renderedOverviewRef.current
    if (
      payload?.renderId !== undefined &&
      payload === committedPayloadRef.current &&
      previous &&
      previous.renderId !== payload.renderId &&
      previous.version === payload.version &&
      previous.boardId === payload.boardId &&
      previous.source === payload.source
    ) {
      handleRendered(payload.version)
    }
  }, [payload, handleRendered])

  const renderer = useMemo(
    () => (payload ? getRenderer(payload.artifactType) : undefined),
    [payload],
  )
  const designLayers = payload?.designLayers?.length ? payload.designLayers : undefined
  const style = useMemo(
    () => artboardStyle(payload?.boardAppearance, tweakPreview?.values ?? payload?.boardTweaks),
    [payload?.boardAppearance, payload?.boardTweaks, tweakPreview?.values],
  )

  return (
    <ArtifactStateContext.Provider value={stateStore}>
      <PreservedStateContext.Provider value={preserved}>
        <div
          ref={rootRef}
          className={`min-h-screen bg-white text-slate-900${designLayers ? ' relative' : ''}`}
          style={style}
        >
          {designLayers ? (
            <DesignLayerScene layers={designLayers} interactive={!payload?.playback} />
          ) : null}
          {payload ? (
            renderer ? (
              renderer({
                source: payload.source,
                ...(payload.artifactType === 'html' && payload.boardId
                  ? { boardId: payload.boardId, artboardView: payload.playback ? 'play' : 'design' }
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
