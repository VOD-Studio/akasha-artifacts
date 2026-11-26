import {
  ARTBOARD_GEOMETRY_LIMITS,
  DESIGN_LAYER_COLORS,
  type DesignLayer,
  type DesignLayerPaletteColor,
  type VersionSummary,
} from '@akasha/protocol'
import { Button } from '@akasha/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@akasha/ui/select'
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignStartVertical,
} from 'lucide-react'
import { useState } from 'react'
import type { CanvasBounds } from '@/entities/artifact'
import { useMessages } from '@/shared/i18n'
import type { CanvasBoardEditing } from '../hooks/useCanvasBoardEditing'
import { ALIGNMENTS, alignItems } from '../lib/canvas-arrangement'
import { canvasToolsMessages } from '../toolbar/canvas-tools-messages'
import { sameGeometry } from '../ui/CanvasGeometryFields'
import { InspectorNumberInput, InspectorRow, InspectorSection } from '../ui/inspector-controls'
import { panelMessages } from './messages'

const ALIGNMENT_ICONS = {
  left: AlignStartVertical,
  center: AlignCenterVertical,
  right: AlignEndVertical,
  top: AlignStartHorizontal,
  middle: AlignCenterHorizontal,
  bottom: AlignEndHorizontal,
} as const

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
} as const satisfies Record<DesignLayerPaletteColor | 'auto', string>

/** 判断色值是否属于内置调色板；自定义十六进制颜色直接原样展示。 */
export function isPaletteColor(color: DesignLayer['color']): color is DesignLayerPaletteColor {
  return color !== undefined && color in DESIGN_LAYER_COLOR_LABELS
}

interface LayoutDraft {
  base: VersionSummary
  original: DesignLayer
  geometry: CanvasBounds
  color: DesignLayer['color']
  selection: readonly DesignLayer[]
}

/** 仅编辑声明的布局图层；位置作用于选区，尺寸只调整当前图层。 */
export function DesignLayerLayout({ boardId, layer, selected, editing }: LayoutProps) {
  const { t } = useMessages(canvasToolsMessages)
  const { t: panelText } = useMessages(panelMessages)
  const [draft, setDraft] = useState<LayoutDraft | null>(null)
  const color = draft ? draft.color : layer.color
  const geometry = draft?.geometry ?? layer
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
  const { coordinate, viewport } = ARTBOARD_GEOMETRY_LIMITS

  const commitLayout = async (nextDraft: LayoutDraft | null) => {
    if (!nextDraft || !editing.available) return
    const { x, y, width, height } = nextDraft.geometry
    const valid =
      Number.isFinite(x) &&
      Number.isFinite(y) &&
      Number.isFinite(width) &&
      Number.isFinite(height) &&
      width >= 1 &&
      height >= 1
    const dirty =
      !sameGeometry(nextDraft.geometry, nextDraft.original) ||
      nextDraft.color !== nextDraft.original.color
    if (!valid || !dirty) {
      setDraft(null)
      return
    }
    const dx = x - nextDraft.original.x
    const dy = y - nextDraft.original.y
    const changes = nextDraft.selection.flatMap((item) => {
      if (item.id === nextDraft.original.id) {
        return [
          {
            id: item.id,
            bounds: { x, y, width, height },
            color:
              nextDraft.color === nextDraft.original.color ? undefined : (nextDraft.color ?? null),
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
    if (await editing.change({ kind: 'layerGeometry', boardId, changes }, nextDraft.base)) {
      setDraft((current) => (current === nextDraft ? null : current))
    }
  }

  const commitDraft = () => {
    void commitLayout(draft)
  }

  const layout = (alignment: (typeof ALIGNMENTS)[number]['id']) => {
    const changes = alignItems(new Map(selected.map((item) => [item.id, item])), alignment)
    if (changes.length) editing.change({ kind: 'layerGeometry', boardId, changes })
  }

  const groupLayers = (layoutGroup: string | null) => {
    const ids = selected.filter((item) => layoutGroup || item.layoutGroup).map((item) => item.id)
    editing.change({ kind: 'layerGroup', boardId, ids, layoutGroup })
  }

  return (
    <section aria-label={t('图层布局')}>
      {selected.length > 1 || canUngroup ? (
        <div className="grid grid-cols-6 items-center border-b border-border/75 px-3 py-1.5">
          {ALIGNMENTS.map(({ id, label }) => {
            const Icon = ALIGNMENT_ICONS[id]
            return (
              <Button
                key={id}
                size="sm"
                variant="ghost"
                iconOnly
                disabled={!canAlign}
                aria-label={t(label)}
                title={t(label)}
                className="mx-auto size-7 rounded-[7px] text-ink-muted hover:text-ink"
                onClick={() => layout(id)}
              >
                <Icon size={14} aria-hidden="true" />
              </Button>
            )
          })}
        </div>
      ) : null}
      <div>
        <InspectorSection title={panelText('尺寸')}>
          <InspectorRow label={t('宽度')}>
            <InspectorNumberInput
              label={t('宽度')}
              suffix="px"
              required
              min={1}
              max={viewport}
              step={1}
              value={geometry.width}
              onChange={(event) =>
                update({ geometry: { ...geometry, width: event.target.valueAsNumber } })
              }
              onBlur={commitDraft}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  commitDraft()
                  event.currentTarget.blur()
                } else if (event.key === 'Escape') {
                  setDraft(null)
                  event.currentTarget.blur()
                }
              }}
            />
          </InspectorRow>
          <InspectorRow label={t('高度')}>
            <InspectorNumberInput
              label={t('高度')}
              suffix="px"
              required
              min={1}
              max={viewport}
              step={1}
              value={geometry.height}
              onChange={(event) =>
                update({ geometry: { ...geometry, height: event.target.valueAsNumber } })
              }
              onBlur={commitDraft}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  commitDraft()
                  event.currentTarget.blur()
                } else if (event.key === 'Escape') {
                  setDraft(null)
                  event.currentTarget.blur()
                }
              }}
            />
          </InspectorRow>
          <InspectorRow label={panelText('位置')}>
            <div className="grid grid-cols-2 gap-1.5">
              <InspectorNumberInput
                prefix="X"
                label={t('横坐标')}
                required
                min={-coordinate}
                max={coordinate}
                step="any"
                value={geometry.x}
                onChange={(event) =>
                  update({ geometry: { ...geometry, x: event.target.valueAsNumber } })
                }
                onBlur={commitDraft}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    commitDraft()
                    event.currentTarget.blur()
                  } else if (event.key === 'Escape') {
                    setDraft(null)
                    event.currentTarget.blur()
                  }
                }}
              />
              <InspectorNumberInput
                prefix="Y"
                label={t('纵坐标')}
                required
                min={-coordinate}
                max={coordinate}
                step="any"
                value={geometry.y}
                onChange={(event) =>
                  update({ geometry: { ...geometry, y: event.target.valueAsNumber } })
                }
                onBlur={commitDraft}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    commitDraft()
                    event.currentTarget.blur()
                  } else if (event.key === 'Escape') {
                    setDraft(null)
                    event.currentTarget.blur()
                  }
                }}
              />
            </div>
          </InspectorRow>
          {selected.length > 1 ? (
            <p className="text-xs text-ink-muted">
              {t('已选 {count} 个图层，仅调整主选图层的尺寸。', { count: selected.length })}
            </p>
          ) : null}
        </InspectorSection>
        <InspectorSection title={panelText('外观')}>
          <InspectorRow label={t('颜色')}>
            <Select
              value={color ?? 'auto'}
              disabled={!editing.available}
              onValueChange={(value) => {
                const nextColor = value === 'auto' ? undefined : (value as DesignLayer['color'])
                const baseDraft: LayoutDraft = {
                  ...(draft ?? {
                    base: editing.version,
                    original: layer,
                    geometry: layer,
                    color: layer.color,
                    selection: selected,
                  }),
                  color: nextColor,
                }
                setDraft(baseDraft)
                void commitLayout(baseDraft)
              }}
            >
              <SelectTrigger aria-label={t('颜色')} controlSize="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">{t(DESIGN_LAYER_COLOR_LABELS.auto)}</SelectItem>
                {DESIGN_LAYER_COLORS.map((item) => (
                  <SelectItem key={item} value={item}>
                    {t(DESIGN_LAYER_COLOR_LABELS[item])}
                  </SelectItem>
                ))}
                {color && !isPaletteColor(color) ? (
                  <SelectItem value={color}>{color}</SelectItem>
                ) : null}
              </SelectContent>
            </Select>
          </InspectorRow>
        </InspectorSection>
      </div>
      <InspectorSection
        collapsible
        defaultOpen={selected.length > 1 || canUngroup}
        title={panelText('操作')}
      >
        {selected.length > 1 || canUngroup ? (
          <div className="grid grid-cols-2 gap-1.5">
            <Button
              size="sm"
              variant="outline"
              className="h-8 rounded-[8px] text-xs"
              disabled={!canGroup}
              onClick={() => groupLayers(crypto.randomUUID())}
            >
              {t('分组图层')}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-8 rounded-[8px] text-xs"
              disabled={!canUngroup}
              onClick={() => groupLayers(null)}
            >
              {t('取消分组')}
            </Button>
          </div>
        ) : (
          <p className="text-xs text-ink-muted">{t('按住 Shift 多选原生图层。')}</p>
        )}
        <div className="grid grid-cols-2 gap-1.5">
          <Button
            size="sm"
            variant="outline"
            className="h-8 rounded-[8px] text-xs"
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
            {t('复制图层')}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-8 rounded-[8px] text-xs text-destructive hover:text-destructive"
            disabled={!editing.available}
            onClick={() => editing.change({ kind: 'layerDelete', boardId, layerId: layer.id })}
          >
            {t('删除图层')}
          </Button>
        </div>
      </InspectorSection>
    </section>
  )
}
