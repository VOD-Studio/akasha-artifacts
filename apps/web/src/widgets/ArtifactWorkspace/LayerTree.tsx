import type { CanvasLayer } from '@akasha/protocol'
import { Button } from '@akasha/ui/button'
import { useEffect, useMemo, useRef } from 'react'

interface LayerTreeProps {
  layers: readonly CanvasLayer[]
  selectedId?: string
  onSelect: (layer: CanvasLayer) => void
}

interface LayerNodeProps {
  layer: CanvasLayer
  groups: ReadonlyMap<string, CanvasLayer[]>
  opened: ReadonlySet<string>
  selectedId?: string
  onSelect: (layer: CanvasLayer) => void
}

/** 图层树只展开 DOM 真正的父子关系，选择用按钮的原生键盘语义。 */
export function LayerTree({ layers, selectedId, onSelect }: LayerTreeProps) {
  const tree = useRef<HTMLUListElement>(null)
  useEffect(() => {
    if (!selectedId) return
    const root = tree.current
    const target = root?.querySelector('button[aria-pressed="true"]')
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
    <ul ref={tree} aria-label="画板图层" className="space-y-0.5 pl-2">
      {groups.get('')?.map((layer) => (
        <LayerNode
          key={layer.id}
          layer={layer}
          groups={groups}
          opened={opened}
          selectedId={selectedId}
          onSelect={onSelect}
        />
      ))}
    </ul>
  )
}

function LayerNode({ layer, groups, opened, selectedId, onSelect }: LayerNodeProps) {
  const label = layer.label || `<${layer.tag}>`
  const children = groups.get(layer.id)
  const button = (
    <Button
      size="sm"
      variant={selectedId === layer.id ? 'secondary' : 'ghost'}
      aria-pressed={selectedId === layer.id}
      className="w-full min-w-0 justify-start"
      onClick={() => onSelect(layer)}
    >
      <span className="truncate">{label}</span>
    </Button>
  )
  return (
    <li className="min-w-0">
      {children?.length ? (
        <details open={!layer.parentId || opened.has(layer.id) || undefined}>
          <summary className="cursor-pointer truncate rounded px-2 py-1 text-xs text-ink-muted">
            {label} · {children.length} 个子图层
          </summary>
          <div className="ml-2 border-l border-border pl-2">
            {button}
            <ul>
              {children.map((child) => (
                <LayerNode
                  key={child.id}
                  layer={child}
                  groups={groups}
                  opened={opened}
                  selectedId={selectedId}
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
