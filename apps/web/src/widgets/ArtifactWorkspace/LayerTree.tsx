import type { CanvasLayer } from '@akasha/protocol'
import { Button } from '@akasha/ui/button'
import { useEffect, useMemo, useRef } from 'react'
import { useMessages } from '@/shared/i18n'
import { panelMessages } from './messages'

interface LayerTreeProps {
  layers: readonly CanvasLayer[]
  /** 主选区用于展开其父级并滚动定位。 */
  selectedId?: string
  /** 额外高亮的图层不触发滚动，也不取代主选区。 */
  selectedIds?: ReadonlySet<string>
  /** Shift 代表在当前选区中切换，是否支持多选由调用方决定。 */
  onSelect: (layer: CanvasLayer, additive: boolean) => void
}

interface LayerNodeProps extends Omit<LayerTreeProps, 'layers'> {
  layer: CanvasLayer
  groups: ReadonlyMap<string, CanvasLayer[]>
  opened: ReadonlySet<string>
}

/** 图层树只展开 DOM 真正的父子关系，选择用按钮的原生键盘语义。 */
export function LayerTree({ layers, selectedId, selectedIds, onSelect }: LayerTreeProps) {
  const { t } = useMessages(panelMessages)
  const tree = useRef<HTMLUListElement>(null)
  useEffect(() => {
    if (!selectedId) return
    const root = tree.current
    const target = root?.querySelector('button[data-primary="true"]')
    for (
      let branch = target?.closest('details');
      branch && root?.contains(branch);
      branch = branch.parentElement?.closest('details')
    ) {
      branch.open = true
    }
    target?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [selectedId])
  const { groups, parents } = useMemo(() => {
    const groups = new Map<string, CanvasLayer[]>()
    const parents = new Map<string, string>()
    for (const layer of layers) {
      if (parents.has(layer.id)) continue
      const parent = layer.parentId && parents.has(layer.parentId) ? layer.parentId : ''
      parents.set(layer.id, parent)
      const siblings = groups.get(parent)
      if (siblings) siblings.push(layer)
      else groups.set(parent, [layer])
    }
    return { groups, parents }
  }, [layers])
  const opened = new Set<string>()
  for (let cursor = selectedId; cursor; cursor = parents.get(cursor)) opened.add(cursor)
  return (
    <ul ref={tree} aria-label={t('画板图层')} className="space-y-0.5 ps-2">
      {groups.get('')?.map((layer) => (
        <LayerNode
          key={layer.id}
          layer={layer}
          groups={groups}
          opened={opened}
          selectedId={selectedId}
          selectedIds={selectedIds}
          onSelect={onSelect}
        />
      ))}
    </ul>
  )
}

function LayerNode({ layer, groups, opened, selectedId, selectedIds, onSelect }: LayerNodeProps) {
  const { t } = useMessages(panelMessages)
  const label = layer.label || `<${layer.tag}>`
  const selected = selectedId === layer.id || Boolean(selectedIds?.has(layer.id))
  const children = groups.get(layer.id)
  const button = (
    <Button
      size="sm"
      variant={selected ? 'secondary' : 'ghost'}
      aria-pressed={selected}
      data-primary={selectedId === layer.id || undefined}
      className="w-full min-w-0 justify-start"
      onClick={(event) => onSelect(layer, event.shiftKey)}
    >
      <bdi className="truncate">{label}</bdi>
    </Button>
  )
  return (
    <li className="min-w-0">
      {children?.length ? (
        <details open={!layer.parentId || opened.has(layer.id) || undefined}>
          <summary className="cursor-pointer truncate rounded px-2 py-1 text-xs text-ink-muted">
            {t('{label} · {count} 个子图层', { label, count: children.length })}
          </summary>
          <div className="ml-2 border-s border-border ps-2">
            {button}
            <ul>
              {children.map((child) => (
                <LayerNode
                  key={child.id}
                  layer={child}
                  groups={groups}
                  opened={opened}
                  selectedId={selectedId}
                  selectedIds={selectedIds}
                  onSelect={onSelect}
                />
              ))}
            </ul>
          </div>
        </details>
      ) : (
        button
      )}
    </li>
  )
}
