import {
  type CanvasElementPresentation,
  type CanvasLayer,
  type CanvasLayerStyles,
  DESIGN_LAYER_BLOCK_PREFIX,
  type SandboxToShellMessage,
  STANDALONE_BOARD_ID,
} from '@akasha/protocol'
import { useCallback, useRef, useState } from 'react'
import type { CanvasBoard, CanvasLocation } from '@/entities/artifact'
import { selectionForVersion, useSelectionStore } from '@/entities/selection'
import { useWorkspaceStore } from '@/entities/workspace'
import type { ShellOutgoingPayload } from '@/shared/bridge/host'
import type { Point } from '../lib/canvas-camera'
import { firstRootLayer } from '../lib/canvas-layer-navigation'

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
  const pendingPoint = useRef<(Scope & { requestId: string }) | null>(null)
  const pendingEnterBoard = useRef<string | null>(null)
  const latest = useRef({ board, current, version, onEnteredLayer })
  latest.current = { board, current, version, onEnteredLayer }

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
    setPresentation(null)
    const store = useSelectionStore.getState()
    if (store.selectedByArtifact[artifactId]) store.clearSelection(artifactId)
  }, [artifactId])
  const pickPoint = useCallback(
    (boardId: string, point: Point) => {
      pendingEnterBoard.current = null
      const requestId = crypto.randomUUID()
      pendingPoint.current = { artifactId, version, boardId, requestId }
      send(boardId, { type: 'inspect.at', purpose: 'select', requestId, version, ...point })
    },
    [artifactId, version, send],
  )
  const onPointTarget = useCallback(
    (boardId: string, message: Extract<SandboxToShellMessage, { type: 'inspect.target' }>) => {
      const pending = pendingPoint.current
      if (
        !pending ||
        pending.requestId !== message.requestId ||
        pending.artifactId !== artifactId ||
        pending.boardId !== boardId ||
        current?.boardId !== boardId ||
        pending.version !== version ||
        message.version !== version
      )
        return
      pendingPoint.current = null
      const { element, layer, presentation: nextPresentation } = message
      if (!element) {
        setPresentation(null)
        return
      }
      setPresentation(
        nextPresentation
          ? { artifactId, version, boardId, layerId: layer?.id, value: nextPresentation }
          : null,
      )
      const selected = useSelectionStore.getState().setSelectedElement
      if (!layer) {
        selected(artifactId, element)
        return
      }
      const blockId = layer.blockId?.startsWith(DESIGN_LAYER_BLOCK_PREFIX)
        ? element.blockId
        : layer.blockId
      selected(
        artifactId,
        { ...element, blockId, selector: layer.selector },
        { id: layer.id, version },
      )
    },
    [artifactId, current?.boardId, version],
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

  return {
    open,
    layers,
    presentation: activePresentation,
    selectedId,
    pendingBoardId,
    onLayers,
    clearPoint,
    pickPoint,
    onPointTarget,
    onSelectSync,
    enterBoard,
    onSelect(layer: CanvasLayer | null, shouldReveal = true) {
      pendingPoint.current = null
      pendingEnterBoard.current = null
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
