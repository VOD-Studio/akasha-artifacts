import type { ElementRef } from '@akasha/protocol'
import { create } from 'zustand'

interface ScopedLayer {
  version: number
  id: string
}

export interface SelectionStoreState {
  /** 指认模式是否开启；关闭时清空悬停元素。 */
  pickerActive: boolean
  /** 当前悬停的元素；同一时刻只有一个。 */
  hoveredElement: ElementRef | null
  /** 每个制品当前选中的元素；切换制品后返回时仍然保留。 */
  selectedByArtifact: Record<string, ElementRef | null>
  /** 结构选择器只属于原画板的渲染节点，不能套用到另一版本。 */
  layersByArtifact: Record<string, ScopedLayer | undefined>
  /** 当前聚焦的反馈 id。 */
  focusedFeedbackId: string | null

  setPickerActive: (active: boolean) => void
  togglePicker: () => void
  setHoveredElement: (el: ElementRef | null) => void
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
  pickerActive: false,
  hoveredElement: null,
  selectedByArtifact: {},
  layersByArtifact: {},
  focusedFeedbackId: null,

  setPickerActive: (pickerActive) =>
    set((s) => ({
      pickerActive,
      hoveredElement: pickerActive ? s.hoveredElement : null,
    })),
  togglePicker: () =>
    set((s) => ({
      pickerActive: !s.pickerActive,
      hoveredElement: !s.pickerActive ? s.hoveredElement : null,
    })),
  setHoveredElement: (hoveredElement) => set({ hoveredElement }),
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
