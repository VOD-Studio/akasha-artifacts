import type { ElementRef } from '@akasha/protocol'
import { create } from 'zustand'

export interface SelectionStoreState {
  /** 指认模式是否开启；关闭时清空悬停元素。 */
  pickerActive: boolean
  /** 当前悬停的元素；同一时刻只有一个。 */
  hoveredElement: ElementRef | null
  /** 每个制品当前选中的元素；切换制品后返回时仍然保留。 */
  selectedByArtifact: Record<string, ElementRef | null>
  /** 当前聚焦的反馈 id。 */
  focusedFeedbackId: string | null

  setPickerActive: (active: boolean) => void
  togglePicker: () => void
  setHoveredElement: (el: ElementRef | null) => void
  setSelectedElement: (artifactId: string, el: ElementRef | null) => void
  clearSelection: (artifactId: string) => void
  setFocusedFeedbackId: (id: string | null) => void
}

/**
 * 元素指认的共享状态容器：指认、批注、Hook 注入与可视化直改共用。
 *
 * @remarks 选区按 `artifactId` 保存，Agent 热更新重绘时不丢失当前选中的元素。
 */
export const useSelectionStore = create<SelectionStoreState>((set) => ({
  pickerActive: false,
  hoveredElement: null,
  selectedByArtifact: {},
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
  setSelectedElement: (artifactId, el) =>
    set((s) => ({
      selectedByArtifact: { ...s.selectedByArtifact, [artifactId]: el },
    })),
  clearSelection: (artifactId) =>
    set((s) => ({
      selectedByArtifact: { ...s.selectedByArtifact, [artifactId]: null },
    })),
  setFocusedFeedbackId: (focusedFeedbackId) => set({ focusedFeedbackId }),
}))
