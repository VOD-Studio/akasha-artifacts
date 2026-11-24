import {
  type CanvasLayer,
  DESIGN_LAYER_BLOCK_PREFIX,
  type ShellToSandboxMessage,
  STANDALONE_BOARD_ID,
} from '@akasha/protocol'
import { useCallback, useState } from 'react'
import { selectionForVersion, useSelectionStore } from '../../entities/selection'
import { useWorkspaceStore } from '../../entities/workspace/store'
import type { CanvasDocument, CanvasLocation } from './canvas-model'

interface BoardInspectionInput {
  artifactId: string
  version: number
  followHead: boolean
  document: CanvasDocument
  current: CanvasLocation | null
  reveal: (target: CanvasLocation) => void
  highlight: (
    boardId: string,
    message: Omit<Extract<ShellToSandboxMessage, { type: 'highlight' }>, 'v' | 'nonce'>,
  ) => void
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
  document,
  current,
  reveal,
  highlight,
}: BoardInspectionInput) {
  const open = useWorkspaceStore((state) => state.inspectorTab === 'inspect')
  const [snapshot, setSnapshot] = useState<
    (Scope & { layers: CanvasLayer[]; truncated: boolean }) | null
  >(null)
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
        highlight(boardId, { type: 'highlight', element, layer })
      }
    },
    [artifactId, followHead, highlight],
  )

  const onLayerPicked = useCallback(
    (boardId: string) => {
      const page =
        document.pages.find(
          (entry) =>
            entry.id === current?.pageId && entry.boards.some((board) => board.id === boardId),
        ) ?? document.pages.find((entry) => entry.boards.some((board) => board.id === boardId))
      if (page && (page.id !== current?.pageId || boardId !== current.boardId)) {
        reveal({ pageId: page.id, boardId })
      }
    },
    [current, document, reveal],
  )

  return {
    open,
    layers,
    selectedId,
    pendingBoardId,
    onLayers,
    onLayerPicked,
    onSelect(layer: CanvasLayer | null) {
      if (!layer) {
        useSelectionStore.getState().clearSelection(artifactId)
        return
      }
      const board = document.pages
        .find((page) => page.id === current?.pageId)
        ?.boards.find((board) => board.id === current?.boardId)
      if (!current || !board || !layers?.layers.includes(layer)) return
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
      highlight(board.id, { type: 'highlight', element, reveal: true, layer: target })
    },
  }
}

function layerBlock(layer: CanvasLayer) {
  return layer.designId ? `${DESIGN_LAYER_BLOCK_PREFIX}${layer.designId}` : layer.blockId
}
