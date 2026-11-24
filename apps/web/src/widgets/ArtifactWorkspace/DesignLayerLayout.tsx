import { DESIGN_LAYER_COLORS, type DesignLayer, type Version } from '@akasha/protocol'
import { Button } from '@akasha/ui/button'
import { Field } from '@akasha/ui/field'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@akasha/ui/select'
import { useState } from 'react'
import { CanvasGeometryFields, sameGeometry } from './CanvasGeometryFields'
import { ALIGNMENTS, alignItems } from './canvas-arrangement'
import type { CanvasBounds } from './canvas-camera'
import type { CanvasBoardEditing } from './useCanvasBoardEditing'

interface LayoutProps {
  /** 图层 id 只在该画板中唯一，不能与其他画板的选择混用。 */
  boardId: string
  /** 主选中的图层；宽高只修改它，位置变化带动整个选区。 */
  layer: DesignLayer
  /** 包含主图层及展开后的同组成员，由检查器限定在同一画板内。 */
  selected: readonly DesignLayer[]
  /** 首次更改时捕获这里的源码版本作为提交基准；不能改用更新后的头版本。 */
  editing: CanvasBoardEditing
}

export const DESIGN_LAYER_COLOR_LABELS = {
  auto: '默认',
  ink: '墨色',
  blue: '蓝色',
  rose: '玫红',
  amber: '琥珀色',
  mint: '薄荷绿',
} satisfies Record<NonNullable<DesignLayer['color']> | 'auto', string>

interface LayoutDraft {
  base: Version
  original: DesignLayer
  geometry: CanvasBounds
  color: DesignLayer['color']
  selection: readonly DesignLayer[]
}

/** 仅编辑声明的布局图层；位置作用于选区，尺寸只调整当前图层。 */
export function DesignLayerLayout({ boardId, layer, selected, editing }: LayoutProps) {
  const [draft, setDraft] = useState<LayoutDraft | null>(null)
  const color = draft ? draft.color : layer.color
  const changed =
    draft && (!sameGeometry(draft.geometry, draft.original) || draft.color !== draft.original.color)
  const update = (patch: Partial<Pick<LayoutDraft, 'geometry' | 'color'>>) => {
    setDraft((previous) => ({
      ...(previous ?? {
        base: editing.version,
        original: layer,
        geometry: layer,
        color: layer.color,
        selection: selected,
      }),
      ...patch,
    }))
  }
  const canAlign = editing.available && selected.length > 1
  const group = selected[0]?.layoutGroup
  const canGroup = canAlign && (!group || selected.some((item) => item.layoutGroup !== group))
  const canUngroup = editing.available && selected.some((item) => item.layoutGroup)

  const layout = (alignment: (typeof ALIGNMENTS)[number]['id']) => {
    const changes = alignItems(new Map(selected.map((item) => [item.id, item])), alignment)
    if (changes.length) editing.change({ kind: 'layerGeometry', boardId, changes })
  }

  const groupLayers = (layoutGroup: string | null) => {
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
            if (item.id === draft.original.id) {
              return [
                {
                  id: item.id,
                  bounds: { x, y, width, height },
                  color: draft.color === draft.original.color ? undefined : (draft.color ?? null),
                },
              ]
            }
            if (!dx && !dy) return []
            return [
              {
                id: item.id,
                bounds: { x: item.x + dx, y: item.y + dy, width: item.width, height: item.height },
                color: undefined,
              },
            ]
          })
          if (editing.change({ kind: 'layerGeometry', boardId, changes }, draft.base)) {
            setDraft(null)
          }
        }}
      >
        <CanvasGeometryFields
          value={draft?.geometry ?? layer}
          onChange={(geometry) => update({ geometry })}
        />
        <Field label="颜色">
          <Select
            value={color ?? 'auto'}
            disabled={!editing.available}
            onValueChange={(value) =>
              update({ color: DESIGN_LAYER_COLORS.find((item) => item === value) })
            }
          >
            <SelectTrigger controlSize="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">{DESIGN_LAYER_COLOR_LABELS.auto}</SelectItem>
              {DESIGN_LAYER_COLORS.map((item) => (
                <SelectItem key={item} value={item}>
                  {DESIGN_LAYER_COLOR_LABELS[item]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Button size="sm" type="submit" disabled={!editing.available || !changed}>
          应用
        </Button>
      </form>
      {selected.length > 1 ? (
        <p className="text-xs text-ink-muted">
          已选 {selected.length} 个图层，仅调整主选图层的尺寸。
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
              取消分组
            </Button>
          </div>
        </>
      ) : (
        <p className="text-xs text-ink-muted">按住 Shift 多选原生图层。</p>
      )}
      <div className="flex gap-1 border-t border-border pt-2">
        <Button
          size="sm"
          variant="ghost"
          disabled={!editing.available}
          onClick={() =>
            editing.change({
              kind: 'layerDuplicate',
              boardId,
              layerId: layer.id,
              id: crypto.randomUUID(),
            })
          }
        >
          复制图层
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={!editing.available}
          onClick={() => editing.change({ kind: 'layerDelete', boardId, layerId: layer.id })}
        >
          删除图层
        </Button>
      </div>
    </section>
  )
}
