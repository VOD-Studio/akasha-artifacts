import {
  type CanvasElementPresentation,
  type CanvasLayer,
  type CanvasLayerStyles,
  DESIGN_LAYER_BLOCK_PREFIX,
  type ElementRef,
  type SandboxToShellMessage,
  STANDALONE_BOARD_ID,
} from '@akasha/protocol'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { CanvasBoard, CanvasLocation } from '@/entities/artifact'
import { selectionForVersion, useSelectionStore } from '@/entities/selection'
import { useWorkspaceStore } from '@/entities/workspace'
import type { ShellOutgoingPayload } from '@/shared/bridge/host'
import type { Point } from '../lib/canvas-camera'
import { firstRootLayer } from '../lib/canvas-layer-navigation'

/** 指针悬停命中画板内元素时的实时定位快照。 */
export interface HoveredCanvasElement {
  boardId: string
  element: ElementRef
  label?: string
}

function formatHoverLabel(element: ElementRef): string | undefined {
  if (element.blockId?.startsWith(DESIGN_LAYER_BLOCK_PREFIX)) {
    return element.textPreview?.trim().slice(0, 28) || undefined
  }
  if (element.blockId) return `#${element.blockId}`
  let tag: string | undefined
  if (element.selector) {
    const leaf = element.selector.split('>').pop()?.trim() ?? ''
    const match = /^([a-zA-Z][\w-]*)/.exec(leaf)
    if (match) tag = match[1].toLowerCase()
  }
  const preview = element.textPreview?.trim().slice(0, 22)
  if (tag && preview) return `${tag} · ${preview}`
  return tag || preview
}

interface BoardInspectionInput {
  artifactId: string
  version: number
  followHead: boolean
  board?: CanvasBoard
  current: CanvasLocation | null
  reveal: (target: CanvasLocation) => void
  send: (boardId: string, message: ShellOutgoingPayload) => void
  /** 从画板标题按 Return 进入首个图层后通知工作区将键盘焦点移入画布图层宿主。 */
  onEnteredLayer?: (boardId: string, layer: CanvasLayer) => void
}

interface Scope {
  artifactId: string
  version: number
  boardId: string
}

/** 运行图层引用只在其制品、版本与画板的作用域内生效。 */
export function useBoardInspection({
  artifactId,
  version,
  followHead,
  board,
  current,
  reveal,
  send,
  onEnteredLayer,
}: BoardInspectionInput) {
  const open = useWorkspaceStore((state) => state.inspectorTab === 'inspect')
  const [snapshot, setSnapshot] = useState<
    (Scope & { layers: CanvasLayer[]; truncated: boolean; styles?: CanvasLayerStyles }) | null
  >(null)
  const [presentation, setPresentation] = useState<
    (Scope & { layerId?: string; value: CanvasElementPresentation }) | null
  >(null)
  const [targetLoc, setTargetLoc] = useState<(Scope & { loc: string }) | null>(null)
  const [hoveredState, setHoveredState] = useState<
    (Scope & { element: ElementRef; label?: string }) | null
  >(null)
  const pendingPoint = useRef<
    | (Scope & {
        requestId: string
        onResolved?: (message: Extract<SandboxToShellMessage, { type: 'inspect.target' }>) => void
      })
    | null
  >(null)
  const pendingHover = useRef<(Scope & { requestId: string }) | null>(null)
  const queuedHover = useRef<{ boardId: string; point: Point } | null>(null)
  const lastHoverPoint = useRef<{ boardId: string; x: number; y: number } | null>(null)
  const hoverFrame = useRef<number | null>(null)
  const lastBoardId = useRef<string | undefined>(current?.boardId)
  const pendingEnterBoard = useRef<string | null>(null)
  const latest = useRef({ board, current, version, onEnteredLayer })
  latest.current = { board, current, version, onEnteredLayer }

  useEffect(() => {
    if (lastBoardId.current === current?.boardId) return
    lastBoardId.current = current?.boardId
    if (
      pendingPoint.current &&
      pendingPoint.current.onResolved === undefined &&
      current?.boardId !== pendingPoint.current.boardId
    ) {
      pendingPoint.current = null
    }
  }, [current?.boardId])

  useEffect(() => {
    return () => {
      if (hoverFrame.current !== null && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(hoverFrame.current)
      }
      hoverFrame.current = null
    }
  }, [])

  const clearHover = useCallback((boardId?: string) => {
    if (!boardId || queuedHover.current?.boardId === boardId) {
      queuedHover.current = null
    }
    if (!boardId || pendingHover.current?.boardId === boardId) {
      pendingHover.current = null
    }
    if (!boardId || lastHoverPoint.current?.boardId === boardId) {
      lastHoverPoint.current = null
    }
    if (!boardId && hoverFrame.current !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(hoverFrame.current)
      hoverFrame.current = null
    }
    setHoveredState((previous) => {
      if (!previous) return null
      if (boardId && previous.boardId !== boardId) return previous
      return null
    })
  }, [])

  const dispatchHover = useCallback(
    (boardId: string, point: Point) => {
      const requestId = crypto.randomUUID()
      pendingHover.current = { artifactId, version, boardId, requestId }
      lastHoverPoint.current = { boardId, x: point.x, y: point.y }
      send(boardId, { type: 'inspect.at', purpose: 'hover', requestId, version, ...point })
    },
    [artifactId, send, version],
  )

  const hoverPoint = useCallback(
    (boardId: string, point: Point) => {
      const previous = lastHoverPoint.current
      if (
        previous?.boardId === boardId &&
        Math.hypot(point.x - previous.x, point.y - previous.y) < 1.5
      ) {
        return
      }
      if (hoverFrame.current !== null) {
        queuedHover.current = { boardId, point }
        return
      }
      dispatchHover(boardId, point)
      if (typeof requestAnimationFrame !== 'function') return
      hoverFrame.current = requestAnimationFrame(() => {
        hoverFrame.current = null
        const queued = queuedHover.current
        queuedHover.current = null
        if (queued) dispatchHover(queued.boardId, queued.point)
      })
    },
    [dispatchHover],
  )

  const onHoverTarget = useCallback(
    (boardId: string, message: Extract<SandboxToShellMessage, { type: 'inspect.target' }>) => {
      const pending = pendingHover.current
      if (
        !pending ||
        pending.requestId !== message.requestId ||
        pending.artifactId !== artifactId ||
        pending.boardId !== boardId ||
        pending.version !== version ||
        message.version !== version
      ) {
        return
      }
      pendingHover.current = null
      const hit = message.element
      if (!hit?.rect || hit.rect.width <= 0 || hit.rect.height <= 0) {
        setHoveredState((previous) => (previous?.boardId === boardId ? null : previous))
        return
      }
      setHoveredState({
        artifactId,
        version,
        boardId,
        element: hit,
        label: formatHoverLabel(hit),
      })
    },
    [artifactId, version],
  )

  const selectLayerDirect = useCallback(
    (
      targetBoard: CanvasBoard,
      targetLocation: CanvasLocation,
      layer: CanvasLayer,
      shouldReveal: boolean,
    ) => {
      const native =
        layer.designId && targetBoard.designLayers?.some((item) => item.id === layer.designId)
      const blockId = native ? `${DESIGN_LAYER_BLOCK_PREFIX}${layer.designId}` : layer.blockId
      const element = {
        selector: layer.selector,
        ...(targetBoard.scoped ? { boardId: targetBoard.id } : {}),
        ...(blockId ? { blockId } : {}),
      }
      const target = { id: layer.id, version: latest.current.version }
      useSelectionStore.getState().setSelectedElement(artifactId, element, target)
      if (shouldReveal) reveal(targetLocation)
      send(targetBoard.id, {
        type: 'highlight',
        element,
        reveal: shouldReveal ? true : undefined,
        layer: target,
      })
    },
    [artifactId, reveal, send],
  )

  const clearPoint = useCallback(() => {
    pendingPoint.current = null
    pendingEnterBoard.current = null
    clearHover()
    setPresentation(null)
    setTargetLoc(null)
    const store = useSelectionStore.getState()
    if (store.selectedByArtifact[artifactId]) store.clearSelection(artifactId)
  }, [artifactId, clearHover])
  const pickPoint = useCallback(
    (
      boardId: string,
      point: Point,
      options?: {
        requestId?: string
        onResolved?: (message: Extract<SandboxToShellMessage, { type: 'inspect.target' }>) => void
      },
    ) => {
      pendingEnterBoard.current = null
      clearHover(boardId)
      const requestId = options?.requestId ?? crypto.randomUUID()
      pendingPoint.current = {
        artifactId,
        version,
        boardId,
        requestId,
        onResolved: options?.onResolved,
      }
      send(boardId, { type: 'inspect.at', purpose: 'select', requestId, version, ...point })
    },
    [artifactId, clearHover, version, send],
  )
  const onPointTarget = useCallback(
    (boardId: string, message: Extract<SandboxToShellMessage, { type: 'inspect.target' }>) => {
      const pending = pendingPoint.current
      if (
        !pending ||
        pending.requestId !== message.requestId ||
        pending.artifactId !== artifactId ||
        pending.boardId !== boardId ||
        pending.version !== version ||
        message.version !== version
      )
        return
      pendingPoint.current = null
      const { element, layer, loc, presentation: nextPresentation } = message
      if (!element) {
        setPresentation(null)
        setTargetLoc(null)
        pending.onResolved?.(message)
        return
      }
      setTargetLoc(loc ? { artifactId, version, boardId, loc } : null)
      setPresentation(
        nextPresentation
          ? { artifactId, version, boardId, layerId: layer?.id, value: nextPresentation }
          : null,
      )
      const selected = useSelectionStore.getState().setSelectedElement
      if (!layer) {
        selected(artifactId, element)
        pending.onResolved?.(message)
        return
      }
      const blockId = layer.blockId?.startsWith(DESIGN_LAYER_BLOCK_PREFIX)
        ? element.blockId
        : layer.blockId
      const resolvedElement = { ...element, blockId, selector: layer.selector }
      selected(artifactId, resolvedElement, { id: layer.id, version })
      pending.onResolved?.({ ...message, element: resolvedElement })
    },
    [artifactId, version],
  )
  const onSelectSync = useCallback(
    (boardId: string, message: Extract<SandboxToShellMessage, { type: 'inspect.select' }>) => {
      if (
        !message.presentation ||
        (message.version !== undefined && message.version !== version) ||
        current?.boardId !== boardId
      )
        return
      setPresentation({
        artifactId,
        version,
        boardId,
        layerId: message.layerId,
        value: message.presentation,
      })
    },
    [artifactId, current?.boardId, version],
  )
  const selectedId = useSelectionStore((state) => {
    const element = selectionForVersion(state, artifactId, version)
    return element && (element.boardId ?? STANDALONE_BOARD_ID) === current?.boardId
      ? state.layersByArtifact[artifactId]?.id
      : undefined
  })
  const pendingBoardId = useSelectionStore((state) => {
    const element = state.selectedByArtifact[artifactId]
    const scope = state.layersByArtifact[artifactId]
    return followHead && scope && scope.version < version && element?.blockId
      ? (element.boardId ?? STANDALONE_BOARD_ID)
      : undefined
  })
  const layers =
    snapshot?.artifactId === artifactId &&
    snapshot.version === version &&
    snapshot.boardId === current?.boardId
      ? snapshot
      : null
  const activePresentation =
    presentation?.artifactId === artifactId &&
    presentation.version === version &&
    presentation.boardId === current?.boardId &&
    (!selectedId || !presentation.layerId || presentation.layerId === selectedId)
      ? presentation.value
      : null
  const onLayers = useCallback(
    (
      boardId: string,
      message: Extract<SandboxToShellMessage, { type: 'inspect.layers.snapshot' }>,
    ) => {
      const { version: activeVersion, layers, truncated, styles } = message
      setSnapshot({ artifactId, version: activeVersion, boardId, layers, truncated, styles })
      if (pendingEnterBoard.current === boardId && activeVersion === latest.current.version) {
        pendingEnterBoard.current = null
        const first = firstRootLayer(layers)
        const live = latest.current
        if (first && live.board && live.board.id === boardId && live.current) {
          selectLayerDirect(live.board, live.current, first, false)
          live.onEnteredLayer?.(boardId, first)
          return
        }
      }
      const store = useSelectionStore.getState()
      const selected = store.selectedByArtifact[artifactId]
      const oldScope = store.layersByArtifact[artifactId]
      if (!oldScope || !selected || (selected.boardId ?? STANDALONE_BOARD_ID) !== boardId) return
      const sameVersion = oldScope.version === activeVersion
      const rebind =
        (sameVersion || (followHead && activeVersion > oldScope.version)) && selected.blockId
      // 新版只能按明确稳定身份重绑；占用旧 CSS 路径的对象与此选区无关。
      const currentLayer =
        (sameVersion ? layers.find((entry) => entry.id === oldScope.id) : undefined) ??
        (rebind ? layers.find((entry) => layerBlock(entry) === selected.blockId) : undefined)
      if (!currentLayer) {
        if (!truncated && (sameVersion || rebind)) store.clearSelection(artifactId)
        return
      }
      const blockId = layerBlock(currentLayer)
      if (
        !sameVersion ||
        currentLayer.id !== oldScope.id ||
        currentLayer.selector !== selected.selector ||
        blockId !== selected.blockId
      ) {
        const layer = { id: currentLayer.id, version: activeVersion }
        const element =
          sameVersion && currentLayer.id === oldScope.id
            ? { ...selected, blockId, selector: currentLayer.selector }
            : {
                boardId: selected.boardId,
                blockId,
                selector: currentLayer.selector,
                loc: currentLayer.sourceLoc,
              }
        store.setSelectedElement(artifactId, element, layer)
        send(boardId, { type: 'highlight', element, layer })
      }
    },
    [artifactId, followHead, selectLayerDirect, send],
  )

  const enterBoard = useCallback(
    (boardId: string) => {
      pendingPoint.current = null
      const live = latest.current
      if (
        snapshot?.artifactId === artifactId &&
        snapshot.version === live.version &&
        snapshot.boardId === boardId &&
        live.board?.id === boardId &&
        live.current
      ) {
        const first = firstRootLayer(snapshot.layers)
        if (first) {
          pendingEnterBoard.current = null
          selectLayerDirect(live.board, live.current, first, false)
          live.onEnteredLayer?.(boardId, first)
          return
        }
      }
      pendingEnterBoard.current = boardId
    },
    [artifactId, selectLayerDirect, snapshot],
  )

  const hovered: HoveredCanvasElement | null =
    hoveredState?.artifactId === artifactId && hoveredState.version === version
      ? {
          boardId: hoveredState.boardId,
          element: hoveredState.element,
          label: hoveredState.label,
        }
      : null

  const activeLoc =
    targetLoc?.artifactId === artifactId &&
    targetLoc.version === version &&
    targetLoc.boardId === current?.boardId
      ? targetLoc.loc
      : undefined

  const preserveSourceSelection = useCallback(
    (boardId: string, loc: string, nextRect: ElementRef['rect'], savedVersion: number) => {
      setTargetLoc({ artifactId, version: savedVersion, boardId, loc })
      const store = useSelectionStore.getState()
      const currentElement = store.selectedByArtifact[artifactId]
      const currentLayer = store.layersByArtifact[artifactId]
      if (!currentElement) return
      const nextElement: ElementRef = {
        ...currentElement,
        ...(nextRect ? { rect: nextRect } : {}),
      }
      store.setSelectedElement(
        artifactId,
        nextElement,
        currentLayer ? { id: currentLayer.id, version: savedVersion } : undefined,
      )
    },
    [artifactId],
  )

  return {
    open,
    layers,
    presentation: activePresentation,
    hovered,
    selectedId,
    selectedLoc: activeLoc,
    pendingBoardId,
    onLayers,
    clearPoint,
    pickPoint,
    onPointTarget,
    hoverPoint,
    clearHover,
    onHoverTarget,
    onSelectSync,
    enterBoard,
    preserveSourceSelection,
    onSelect(layer: CanvasLayer | null, shouldReveal = true) {
      pendingPoint.current = null
      pendingEnterBoard.current = null
      setTargetLoc(null)
      if (!layer) {
        setPresentation(null)
        useSelectionStore.getState().clearSelection(artifactId)
        return
      }
      if (!current || !board || board.id !== current.boardId || !layers?.layers.includes(layer))
        return
      selectLayerDirect(board, current, layer, shouldReveal)
    },
  }
}

function layerBlock(layer: CanvasLayer) {
  return layer.designId ? `${DESIGN_LAYER_BLOCK_PREFIX}${layer.designId}` : layer.blockId
}
