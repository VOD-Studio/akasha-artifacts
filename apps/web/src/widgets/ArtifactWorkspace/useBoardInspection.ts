import {
  type CanvasLayer,
  DESIGN_LAYER_BLOCK_PREFIX,
  type SandboxToShellMessage,
  STANDALONE_BOARD_ID,
} from '@akasha/protocol'
import { useCallback, useRef, useState } from 'react'
import type { CanvasBoard, CanvasLocation } from '@/entities/artifact'
import { selectionForVersion, useSelectionStore } from '@/entities/selection'
import { useWorkspaceStore } from '@/entities/workspace'
import type { ShellOutgoingPayload } from '@/shared/bridge/host'
import type { Point } from './canvas-camera'

interface BoardInspectionInput {
  artifactId: string
  version: number
  followHead: boolean
  board?: CanvasBoard
  current: CanvasLocation | null
  reveal: (target: CanvasLocation) => void
  send: (boardId: string, message: ShellOutgoingPayload) => void
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
}: BoardInspectionInput) {
  const open = useWorkspaceStore((state) => state.inspectorTab === 'inspect')
  const [snapshot, setSnapshot] = useState<
    (Scope & { layers: CanvasLayer[]; truncated: boolean }) | null
  >(null)
  const pendingPoint = useRef<(Scope & { requestId: string }) | null>(null)
  const clearPoint = useCallback(() => {
    pendingPoint.current = null
    const store = useSelectionStore.getState()
    if (store.selectedByArtifact[artifactId]) store.clearSelection(artifactId)
  }, [artifactId])
  const pickPoint = useCallback(
    (boardId: string, point: Point) => {
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
      const { element, layer } = message
      if (!element) return
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
    open &&
    snapshot?.artifactId === artifactId &&
    snapshot.version === version &&
    snapshot.boardId === current?.boardId
      ? snapshot
      : null
  const onLayers = useCallback(
    (boardId: string, activeVersion: number, layers: CanvasLayer[], truncated: boolean) => {
      setSnapshot({ artifactId, version: activeVersion, boardId, layers, truncated })
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
    [artifactId, followHead, send],
  )

  return {
    open,
    layers,
    selectedId,
    pendingBoardId,
    onLayers,
    clearPoint,
    pickPoint,
    onPointTarget,
    onSelect(layer: CanvasLayer | null) {
      pendingPoint.current = null
      if (!layer) {
        useSelectionStore.getState().clearSelection(artifactId)
        return
      }
      if (!current || !board || board.id !== current.boardId || !layers?.layers.includes(layer))
        return
      const native =
        layer.designId && board.designLayers?.some((item) => item.id === layer.designId)
      const blockId = native ? `${DESIGN_LAYER_BLOCK_PREFIX}${layer.designId}` : layer.blockId
      const element = {
        selector: layer.selector,
        ...(board.scoped ? { boardId: board.id } : {}),
        ...(blockId ? { blockId } : {}),
      }
      const target = { id: layer.id, version }
      useSelectionStore.getState().setSelectedElement(artifactId, element, target)
      reveal(current)
      send(board.id, { type: 'highlight', element, reveal: true, layer: target })
    },
  }
}

function layerBlock(layer: CanvasLayer) {
  return layer.designId ? `${DESIGN_LAYER_BLOCK_PREFIX}${layer.designId}` : layer.blockId
}
