import type { CanvasLayer, ShellToSandboxMessage } from '@akasha/protocol'
import { useCallback, useState } from 'react'
import { selectionForVersion, useSelectionStore } from '../../entities/selection/store'
import { useWorkspaceStore } from '../../entities/workspace/store'
import { type CanvasDocument, type CanvasLocation, STANDALONE_BOARD_ID } from './canvas-model'

interface BoardInspectionInput {
  artifactId: string
  version: number
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
      const selected = selectionForVersion(store, artifactId, activeVersion)
      const layer = store.layersByArtifact[artifactId]
      if (!layer || !selected || (selected.boardId ?? STANDALONE_BOARD_ID) !== boardId) return
      const currentLayer = layers.find((entry) => entry.id === layer.id)
      if (!currentLayer) {
        // 树的展示上限不是节点被移除的证据。
        if (!truncated) store.clearSelection(artifactId)
      } else if (currentLayer.selector !== selected.selector) {
        const element = { ...selected, selector: currentLayer.selector }
        store.setSelectedElement(artifactId, element, layer)
        highlight(boardId, { type: 'highlight', element, layer })
      }
    },
    [artifactId, highlight],
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
    onLayers,
    onLayerPicked,
    onSelect(layer: CanvasLayer) {
      const board = document.pages
        .find((page) => page.id === current?.pageId)
        ?.boards.find((board) => board.id === current?.boardId)
      if (!current || !board || !layers?.layers.includes(layer)) return
      const element = { selector: layer.selector, ...(board.scoped ? { boardId: board.id } : {}) }
      const target = { id: layer.id, version }
      useSelectionStore.getState().setSelectedElement(artifactId, element, target)
      reveal(current)
      highlight(board.id, { type: 'highlight', element, reveal: true, layer: target })
    },
  }
}
