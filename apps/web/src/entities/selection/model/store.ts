import type { ElementRef } from '@akasha/protocol'
import { create } from 'zustand'

interface ScopedLayer {
  version: number
  id: string
}

/** 工作区按作品保存的元素和批注选区。 */
export interface SelectionStoreState {
  /** 按作品公开标识保存；切回同一作品仍能恢复。 */
  selectedByArtifact: Record<string, ElementRef | null>
  /** 结构选择器限定在选中时的画板和版本，不能套用到其他快照。 */
  layersByArtifact: Record<string, ScopedLayer | undefined>
  /** 当前聚焦的反馈 id。 */
  focusedFeedbackId: string | null

  setSelectedElement: (artifactId: string, el: ElementRef | null, layer?: ScopedLayer) => void
  clearSelection: (artifactId: string) => void
  setFocusedFeedbackId: (id: string | null) => void
}

/** 历史快照不继承其他版本的 DOM 选区；旧式块引用仍按自身契约保态。 */
export function selectionForVersion(
  state: SelectionStoreState,
  artifactId: string,
  version: number,
) {
  const layer = state.layersByArtifact[artifactId]
  return layer && layer.version !== version ? null : (state.selectedByArtifact[artifactId] ?? null)
}

/**
 * 元素指认的共享状态容器：指认、批注、Hook 注入与可视化直改共用。
 *
 * @remarks 选区按 `artifactId` 保存，Agent 热更新重绘时不丢失当前选中的元素。
 */
export const useSelectionStore = create<SelectionStoreState>((set, get) => ({
  selectedByArtifact: {},
  layersByArtifact: {},
  focusedFeedbackId: null,

  setSelectedElement: (artifactId, el, layer) =>
    set((s) => ({
      selectedByArtifact: { ...s.selectedByArtifact, [artifactId]: el },
      layersByArtifact:
        layer || s.layersByArtifact[artifactId]
          ? { ...s.layersByArtifact, [artifactId]: el ? layer : undefined }
          : s.layersByArtifact,
    })),
  clearSelection: (artifactId) => get().setSelectedElement(artifactId, null),
  setFocusedFeedbackId: (focusedFeedbackId) => set({ focusedFeedbackId }),
}))
