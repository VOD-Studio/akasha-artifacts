import { Button } from '@akasha/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@akasha/ui/popover'
import { Group } from 'lucide-react'
import { useState } from 'react'
import { ALIGNMENTS, alignItems } from './canvas-arrangement'
import type { CanvasBounds } from './canvas-camera'
import type { CanvasBoard } from './canvas-model'
import type { CanvasBoardEditing } from './useCanvasBoardEditing'

interface ArrangeMenuProps {
  selected: readonly CanvasBoard[]
  bounds: ReadonlyMap<string, CanvasBounds>
  editing: CanvasBoardEditing
}

/** 排列仅作用于当前页面选中的画板，编辑通过同一版本写入通道。 */
export function CanvasArrangeMenu({ selected, bounds, editing }: ArrangeMenuProps) {
  const [open, setOpen] = useState(false)
  const canAlign = editing.available && selected.length > 1
  const group = selected[0]?.layoutGroup
  const canGroup = canAlign && (!group || selected.some((board) => board.layoutGroup !== group))
  const canUngroup = editing.available && selected.some((board) => board.layoutGroup)

  const arrange = (id: (typeof ALIGNMENTS)[number]['id']) => {
    if (!canAlign) return
    const selection = new Map<string, CanvasBounds>()
    for (const board of selected) {
      const box = bounds.get(board.id)
      if (box) selection.set(board.id, box)
    }
    const changes = alignItems(selection, id)
    if (changes.length) editing.change({ kind: 'geometry', changes })
    setOpen(false)
  }

  const groupBoards = (layoutGroup: string | null) => {
    const ids = selected
      .filter((board) => layoutGroup || board.layoutGroup)
      .map((board) => board.id)
    editing.change({ kind: 'group', ids, layoutGroup })
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          aria-label="排列画板"
          title="排列画板（Shift 多选）"
        >
          <Group size={15} />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-60 space-y-2" aria-label="排列画板">
        <p className="text-xs text-ink-muted">
          {selected.length > 1 ? `已选 ${selected.length} 张画板` : '按住 Shift 多选画板标题。'}
        </p>
        <div className="grid grid-cols-2 gap-1">
          {ALIGNMENTS.map(({ id, label }) => (
            <Button
              key={id}
              variant="ghost"
              size="sm"
              disabled={!canAlign}
              onClick={() => arrange(id)}
            >
              {label}
            </Button>
          ))}
        </div>
        <div className="flex gap-1 border-t border-border pt-2">
          <Button
            variant="ghost"
            size="sm"
            disabled={!canGroup}
            onClick={() => groupBoards(crypto.randomUUID())}
          >
            分组画板
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={!canUngroup}
            onClick={() => groupBoards(null)}
          >
            取消分组
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
