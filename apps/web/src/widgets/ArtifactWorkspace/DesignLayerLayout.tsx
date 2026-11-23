import type { DesignLayer, Version } from '@akasha/protocol'
import { Button } from '@akasha/ui/button'
import { useState } from 'react'
import { CanvasGeometryFields, sameGeometry } from './CanvasGeometryFields'
import { ALIGNMENTS, alignItems } from './canvas-arrangement'
import type { CanvasBounds } from './canvas-camera'
import type { CanvasBoardEditing } from './useCanvasBoardEditing'

interface LayoutProps {
  boardId: string
  layer: DesignLayer
  selected: readonly DesignLayer[]
  editing: CanvasBoardEditing
}

/** 仅编辑声明的布局图层；位置作用于选区，尺寸只调整当前图层。 */
export function DesignLayerLayout({ boardId, layer, selected, editing }: LayoutProps) {
  const [draft, setDraft] = useState<{
    base: Version
    original: DesignLayer
    geometry: CanvasBounds
    selection: readonly DesignLayer[]
  } | null>(null)
  const canAlign = editing.available && selected.length > 1
  const group = selected[0]?.layoutGroup
  const canGroup = canAlign && (!group || selected.some((item) => item.layoutGroup !== group))
  const canUngroup = editing.available && selected.some((item) => item.layoutGroup)

  function layout(alignment: (typeof ALIGNMENTS)[number]['id']) {
    const changes = alignItems(new Map(selected.map((item) => [item.id, item])), alignment)
    if (changes.length) editing.change({ kind: 'layerGeometry', boardId, changes })
  }

  function groupLayers(layoutGroup: string | null) {
    const ids = selected.filter((item) => layoutGroup || item.layoutGroup).map((item) => item.id)
    editing.change({ kind: 'layerGroup', boardId, ids, layoutGroup })
  }

  return (
    <section className="mt-4 space-y-3 border-t border-border pt-3" aria-label="图层布局">
      <form
        className="space-y-2"
        onSubmit={(event) => {
          event.preventDefault()
          if (!draft || !editing.available) return
          const { x, y, width, height } = draft.geometry
          const dx = x - draft.original.x
          const dy = y - draft.original.y
          const changes = draft.selection.flatMap((item) => {
            if (item.id === draft.original.id)
              return [{ id: item.id, bounds: { x, y, width, height } }]
            if (!dx && !dy) return []
            return [
              {
                id: item.id,
                bounds: { x: item.x + dx, y: item.y + dy, width: item.width, height: item.height },
              },
            ]
          })
          editing.change({ kind: 'layerGeometry', boardId, changes }, draft.base)
          setDraft(null)
        }}
      >
        <CanvasGeometryFields
          value={draft?.geometry ?? layer}
          onChange={(geometry) =>
            setDraft(
              draft
                ? { ...draft, geometry }
                : { base: editing.version, original: layer, geometry, selection: selected },
            )
          }
        />
        <Button
          size="sm"
          type="submit"
          disabled={!editing.available || !draft || sameGeometry(draft.geometry, draft.original)}
        >
          应用图层布局
        </Button>
      </form>
      {selected.length > 1 ? (
        <p className="text-xs text-ink-muted">
          已选 {selected.length} 个图层，尺寸只作用于主选中的图层。
        </p>
      ) : null}
      {selected.length > 1 || canUngroup ? (
        <>
          <div className="grid grid-cols-2 gap-1">
            {ALIGNMENTS.map(({ id, label }) => (
              <Button
                key={id}
                size="sm"
                variant="ghost"
                disabled={!canAlign}
                onClick={() => layout(id)}
              >
                {label}
              </Button>
            ))}
          </div>
          <div className="flex gap-1">
            <Button
              size="sm"
              variant="ghost"
              disabled={!canGroup}
              onClick={() => groupLayers(crypto.randomUUID())}
            >
              分组图层
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={!canUngroup}
              onClick={() => groupLayers(null)}
            >
              取消图层分组
            </Button>
          </div>
        </>
      ) : (
        <p className="text-xs text-ink-muted">按住 Shift 可在树中选取多个原生图层。</p>
      )}
    </section>
  )
}
