import type { ElementRef } from '@akasha/protocol'
import { create } from 'zustand'

export interface SelectionStoreState {
  pickerActive: boolean
  hoveredElement: ElementRef | null
  selectedByArtifact: Record<string, ElementRef | null>
  focusedFeedbackId: string | null

  setPickerActive: (active: boolean) => void
  togglePicker: () => void
  setHoveredElement: (el: ElementRef | null) => void
  setSelectedElement: (artifactId: string, el: ElementRef | null) => void
  clearSelection: (artifactId: string) => void
  setFocusedFeedbackId: (id: string | null) => void
}

// 元素指认共享实体模型（architecture §12.3）：供指认、批注、Hook 注入与后续 L4 直改共同依赖，
// 并按 artifactId 持久化选区，确保 Agent 热更新重绘时不丢失当前选中元素。
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
