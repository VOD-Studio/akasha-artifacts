import { Button } from '@akasha/ui/button'
import { ListHighlight, ListHighlightItem } from '@akasha/ui/list-highlight'
import { Popover, PopoverContent, PopoverTrigger } from '@akasha/ui/popover'
import { Group } from 'lucide-react'
import { useState } from 'react'
import type { CanvasBoard, CanvasBounds } from '@/entities/artifact'
import { useMessages } from '@/shared/i18n'
import type { CanvasBoardEditing } from '../hooks/useCanvasBoardEditing'
import { ALIGNMENTS, alignItems } from '../lib/canvas-arrangement'
import { canvasToolsMessages } from './canvas-tools-messages'

interface ArrangeMenuProps {
  selected: readonly CanvasBoard[]
  bounds: ReadonlyMap<string, CanvasBounds>
  editing: CanvasBoardEditing
}

/** 排列仅作用于当前页面选中的画板，编辑通过同一版本写入通道。 */
export function CanvasArrangeMenu({ selected, bounds, editing }: ArrangeMenuProps) {
  const { t } = useMessages(canvasToolsMessages)
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
        <ListHighlightItem>
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            aria-label={t('排列画板')}
            title={t('排列画板（Shift 多选）')}
          >
            <Group size={15} />
          </Button>
        </ListHighlightItem>
      </PopoverTrigger>
      <PopoverContent side="top" sideOffset={8} className="w-60 p-2" aria-label={t('排列画板')}>
        <ListHighlight>
          <div className="artifact-canvas-list-menu space-y-2">
            <p className="px-1.5 text-xs text-ink-muted">
              {selected.length > 1
                ? t('已选 {count} 张画板', { count: selected.length })
                : t('按住 Shift 多选画板标题。')}
            </p>
            <div className="grid grid-cols-2 gap-1">
              {ALIGNMENTS.map(({ id, label }) => (
                <ListHighlightItem key={id}>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 rounded-8 text-xs"
                    disabled={!canAlign}
                    onClick={() => arrange(id)}
                  >
                    {t(label)}
                  </Button>
                </ListHighlightItem>
              ))}
            </div>
            <div className="flex flex-wrap gap-1 border-t border-border/75 pt-2">
              <ListHighlightItem>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 rounded-8 text-xs"
                  disabled={!canAlign}
                  onClick={() => {
                    editing.change({
                      kind: 'boardFlip',
                      ids: selected.map((board) => board.id),
                      bounds,
                      axis: 'horizontal',
                    })
                    setOpen(false)
                  }}
                >
                  {t('水平翻转')}
                </Button>
              </ListHighlightItem>
              <ListHighlightItem>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 rounded-8 text-xs"
                  disabled={!canAlign}
                  onClick={() => {
                    editing.change({
                      kind: 'boardFlip',
                      ids: selected.map((board) => board.id),
                      bounds,
                      axis: 'vertical',
                    })
                    setOpen(false)
                  }}
                >
                  {t('垂直翻转')}
                </Button>
              </ListHighlightItem>
              <ListHighlightItem>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 rounded-8 text-xs"
                  disabled={!canGroup}
                  onClick={() => groupBoards(crypto.randomUUID())}
                >
                  {t('分组画板')}
                </Button>
              </ListHighlightItem>
              <ListHighlightItem>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 rounded-8 text-xs"
                  disabled={!canUngroup}
                  onClick={() => groupBoards(null)}
                >
                  {t('取消分组')}
                </Button>
              </ListHighlightItem>
            </div>
          </div>
        </ListHighlight>
      </PopoverContent>
    </Popover>
  )
}
