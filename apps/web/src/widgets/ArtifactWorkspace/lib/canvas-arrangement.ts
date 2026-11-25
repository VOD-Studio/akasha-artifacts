import type { CanvasBounds } from '@/entities/artifact'

interface ArrangementItem {
  id: string
  layoutGroup?: string
}

/** 主选中对象用于检查器；其他对象形成一次布局操作的作用域。 */
export interface LayoutSelection {
  selected: string | null
  selectedIds?: readonly string[]
}

/** 物件只会与当前容器内的同组成员联动。 */
export function groupMembers(items: readonly ArrangementItem[], id: string): string[] {
  const selected = items.find((item) => item.id === id)
  if (!selected) return []
  return selected.layoutGroup
    ? items.filter((item) => item.layoutGroup === selected.layoutGroup).map((item) => item.id)
    : [id]
}

/** 仅采用当前画板或页面仍包含的标识；旧选区不能跨容器生效。 */
export function layoutSelectionIds(items: readonly ArrangementItem[], selection: LayoutSelection) {
  const explicit = new Set(selection.selectedIds)
  if (selection.selected) explicit.add(selection.selected)
  const groups = new Set<string>()
  for (const item of items) {
    if (item.layoutGroup && explicit.has(item.id)) groups.add(item.layoutGroup)
  }
  return new Set(
    items
      .filter((item) => explicit.has(item.id) || (item.layoutGroup && groups.has(item.layoutGroup)))
      .map((item) => item.id),
  )
}

/** Shift 切换对象或组；主选区仍然是单个、明确存在的对象。 */
export function changeLayoutSelection(
  items: readonly ArrangementItem[],
  selection: LayoutSelection,
  id: string | null,
  additive: boolean,
): LayoutSelection {
  if (!id || !additive) return { selected: id }
  const selected = layoutSelectionIds(items, selection)
  const group = groupMembers(items, id)
  if (group.every((member) => selected.has(member))) {
    for (const member of group) selected.delete(member)
  } else {
    for (const member of group) selected.add(member)
  }
  return {
    selected: selected.has(id) ? id : (Array.from(selected).at(-1) ?? null),
    selectedIds: Array.from(selected),
  }
}

/** 对齐基准是整个选区的包围盒；尺寸不参与改写。 */
export const ALIGNMENTS = [
  { id: 'left', label: '左对齐' },
  { id: 'center', label: '水平居中' },
  { id: 'right', label: '右对齐' },
  { id: 'top', label: '顶端对齐' },
  { id: 'middle', label: '垂直居中' },
  { id: 'bottom', label: '底端对齐' },
] as const

/** 只接收版本里的有效几何，不以页尺寸或相机作为对齐基准。 */
export function fitSelection(bounds: Iterable<CanvasBounds>) {
  let left = Infinity,
    top = Infinity,
    right = -Infinity,
    bottom = -Infinity
  for (const item of bounds) {
    left = Math.min(left, item.x)
    top = Math.min(top, item.y)
    right = Math.max(right, item.x + item.width)
    bottom = Math.max(bottom, item.y + item.height)
  }
  return left === Infinity
    ? undefined
    : { x: left, y: top, width: right - left, height: bottom - top }
}

/** 只返回实际发生几何变化的对象，一次保存可以应用整组选区。 */
export function alignItems(
  items: ReadonlyMap<string, CanvasBounds>,
  alignment: (typeof ALIGNMENTS)[number]['id'],
) {
  const fit = fitSelection(items.values())
  if (!fit || items.size < 2) return []
  const changes: Array<{ id: string; bounds: CanvasBounds }> = []
  for (const [id, bounds] of items) {
    let { x, y } = bounds
    switch (alignment) {
      case 'left':
        x = fit.x
        break
      case 'center':
        x = fit.x + (fit.width - bounds.width) / 2
        break
      case 'right':
        x = fit.x + fit.width - bounds.width
        break
      case 'top':
        y = fit.y
        break
      case 'middle':
        y = fit.y + (fit.height - bounds.height) / 2
        break
      case 'bottom':
        y = fit.y + fit.height - bounds.height
        break
    }
    if (x !== bounds.x || y !== bounds.y) changes.push({ id, bounds: { ...bounds, x, y } })
  }
  return changes
}
