import type { ArtboardTweak, ArtboardTweakValues } from '@akasha/protocol'
import { createStore, type StoreApi } from 'zustand'

interface BoardTweakPreviews {
  byBoard: ReadonlyMap<string, ArtboardTweakValues>
  set: (boardId: string, field: ArtboardTweak, value: ArtboardTweakValues[string]) => void
  reset: (boardId: string) => void
}

export type BoardTweakPreviewStore = StoreApi<BoardTweakPreviews>

/** 每个已打开的版本各建一份；只存非默认覆写，不进入作品状态流或导出。 */
export function createBoardTweakPreviewStore(): BoardTweakPreviewStore {
  return createStore<BoardTweakPreviews>((set) => ({
    byBoard: new Map(),
    set: (boardId, field, value) =>
      set((state) => {
        const previous = state.byBoard.get(boardId)
        const next = value === field.default ? undefined : value
        if (previous?.[field.id] === next) return state
        const values = { ...previous }
        if (next === undefined) delete values[field.id]
        else values[field.id] = next
        const byBoard = new Map(state.byBoard)
        if (Object.keys(values).length > 0) byBoard.set(boardId, values)
        else byBoard.delete(boardId)
        return { byBoard }
      }),
    reset: (boardId) =>
      set((state) => {
        if (!state.byBoard.has(boardId)) return state
        const byBoard = new Map(state.byBoard)
        byBoard.delete(boardId)
        return { byBoard }
      }),
  }))
}
