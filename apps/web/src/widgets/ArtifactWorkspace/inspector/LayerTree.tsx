import type { CanvasLayer } from '@akasha/protocol'
import { Button } from '@akasha/ui/button'
import { type KeyboardEvent, useEffect, useMemo, useRef } from 'react'
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

function visibleLayerButtons(root: HTMLElement): HTMLButtonElement[] {
  const buttons: HTMLButtonElement[] = []
  for (const button of root.querySelectorAll<HTMLButtonElement>('button[data-layer-id]')) {
    let hidden = false
    for (
      let branch = button.parentElement?.closest('details');
      branch && root.contains(branch);
      branch = branch.parentElement?.closest('details')
    ) {
      if (!branch.open) {
        hidden = true
        break
      }
    }
    if (!hidden) buttons.push(button)
  }
  return buttons
}

/**
 * 图层树只展开 DOM 真正的父子关系；方向键仅在树项间移动键盘焦点，不改变画布选区。
 *
 * @remarks 仅显式点击或按 Enter/Space 时触发 `onSelect`，防止树焦点被误当选区。
 */
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

  const handleTreeKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    const root = tree.current
    const active = event.target instanceof HTMLButtonElement ? event.target : null
    if (!root || !active?.dataset.layerId) return
    const items = visibleLayerButtons(root)
    const index = items.indexOf(active)
    if (index === -1) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      items[Math.min(items.length - 1, index + 1)]?.focus({ preventScroll: true })
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      items[Math.max(0, index - 1)]?.focus({ preventScroll: true })
    } else if (event.key === 'Home') {
      event.preventDefault()
      items[0]?.focus({ preventScroll: true })
    } else if (event.key === 'End') {
      event.preventDefault()
      items[items.length - 1]?.focus({ preventScroll: true })
    } else if (event.key === 'ArrowRight') {
      const container = active.closest('li')?.querySelector<HTMLDetailsElement>(':scope > details')
      if (container && !container.open) {
        event.preventDefault()
        container.open = true
      } else if (groups.get(active.dataset.layerId)?.length) {
        event.preventDefault()
        items[index + 1]?.focus({ preventScroll: true })
      }
    } else if (event.key === 'ArrowLeft') {
      const ownBranch = active.closest('li')?.querySelector<HTMLDetailsElement>(':scope > details')
      if (ownBranch?.open && active.closest('details') === ownBranch) {
        event.preventDefault()
        ownBranch.open = false
        return
      }
      const parentId = parents.get(active.dataset.layerId)
      if (parentId) {
        event.preventDefault()
        for (const button of root.querySelectorAll<HTMLButtonElement>('button[data-layer-id]')) {
          if (button.dataset.layerId === parentId) {
            button.focus({ preventScroll: true })
            break
          }
        }
      }
    }
  }

  return (
    <ul
      ref={tree}
      aria-label={t('画板图层')}
      className="space-y-0.5 ps-2"
      onKeyDown={handleTreeKeyDown}
    >
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
      data-layer-id={layer.id}
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
