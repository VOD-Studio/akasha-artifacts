import type { CanvasLayer } from '@akasha/protocol'
import { ChevronRight, Hash, Image, Shapes, Square, Type } from 'lucide-react'
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react'
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

const VECTOR_CONTAINER_TAGS = new Set([
  'svg',
  'g',
  'defs',
  'clippath',
  'mask',
  'pattern',
  'symbol',
  'marker',
])

const TEXT_TAGS = new Set([
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'p',
  'span',
  'a',
  'label',
  'strong',
  'em',
  'small',
  'blockquote',
  'li',
  'text',
  'tspan',
])

const IMAGE_TAGS = new Set(['img', 'picture', 'video', 'canvas'])

const SHAPE_TAGS = new Set(['path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon'])

function LayerIcon({ layer }: { layer: CanvasLayer }) {
  const tag = layer.tag.toLowerCase()
  if (TEXT_TAGS.has(tag)) return <Type size={12} className="shrink-0 opacity-65" />
  if (IMAGE_TAGS.has(tag)) return <Image size={12} className="shrink-0 opacity-65" />
  if (VECTOR_CONTAINER_TAGS.has(tag) || SHAPE_TAGS.has(tag)) {
    return <Shapes size={12} className="shrink-0 opacity-65" />
  }
  if (layer.designId) return <Square size={12} className="shrink-0 opacity-65" />
  return <Hash size={12} className="shrink-0 opacity-65" />
}

function defaultExpanded(layer: CanvasLayer) {
  return !layer.parentId && !VECTOR_CONTAINER_TAGS.has(layer.tag.toLowerCase())
}

/**
 * 单行扁平层级树：每项仅展示一行（折叠箭头 + 语义图标 + 名称 + 子项数），
 * 默认折叠 svg 矢量容器子树；方向键仅移动树焦点，不提前改变画布选区。
 */
export function LayerTree({ layers, selectedId, selectedIds, onSelect }: LayerTreeProps) {
  const { t } = useMessages(panelMessages)
  const tree = useRef<HTMLUListElement>(null)
  const [toggles, setToggles] = useState<ReadonlyMap<string, boolean>>(() => new Map())

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

  // 仅当选区切换到新图层时自动展开其祖先路径，之后允许用户随时手动收起父节点。
  const expandedSelectionRef = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (!selectedId || expandedSelectionRef.current === selectedId) return
    expandedSelectionRef.current = selectedId
    const ancestors: string[] = []
    for (let cursor = parents.get(selectedId); cursor; cursor = parents.get(cursor)) {
      ancestors.push(cursor)
    }
    if (ancestors.length > 0) {
      setToggles((prev) => {
        let changed = false
        const next = new Map(prev)
        for (const id of ancestors) {
          if (next.get(id) !== true) {
            next.set(id, true)
            changed = true
          }
        }
        return changed ? next : prev
      })
    }
  }, [parents, selectedId])

  useEffect(() => {
    if (!selectedId) return
    const target = tree.current?.querySelector<HTMLButtonElement>('button[data-primary="true"]')
    target?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [selectedId])

  const isExpanded = (layer: CanvasLayer) => {
    const manual = toggles.get(layer.id)
    if (manual !== undefined) return manual
    return defaultExpanded(layer)
  }

  const toggleNode = (layer: CanvasLayer) => {
    const current = isExpanded(layer)
    setToggles((prev) => {
      const next = new Map(prev)
      next.set(layer.id, !current)
      return next
    })
  }

  const handleTreeKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    const root = tree.current
    const active = event.target instanceof HTMLButtonElement ? event.target : null
    if (!root || !active?.dataset.layerId) return
    const items = Array.from(root.querySelectorAll<HTMLButtonElement>('button[data-layer-id]'))
    const index = items.indexOf(active)
    if (index === -1) return
    const currentId = active.dataset.layerId
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
      const layer = layers.find((entry) => entry.id === currentId)
      const children = groups.get(currentId)
      if (layer && children?.length) {
        event.preventDefault()
        if (!isExpanded(layer)) {
          setToggles((prev) => new Map(prev).set(currentId, true))
        } else {
          items[index + 1]?.focus({ preventScroll: true })
        }
      }
    } else if (event.key === 'ArrowLeft') {
      const layer = layers.find((entry) => entry.id === currentId)
      const children = groups.get(currentId)
      if (layer && children?.length && isExpanded(layer)) {
        event.preventDefault()
        setToggles((prev) => new Map(prev).set(currentId, false))
        return
      }
      const parentId = parents.get(currentId)
      if (parentId) {
        event.preventDefault()
        const parentBtn = items.find((button) => button.dataset.layerId === parentId)
        parentBtn?.focus({ preventScroll: true })
      }
    }
  }

  return (
    <ul
      ref={tree}
      aria-label={t('画板图层')}
      className="space-y-0.5 py-0.5"
      onKeyDown={handleTreeKeyDown}
    >
      {groups.get('')?.map((layer) => (
        <LayerNode
          key={layer.id}
          layer={layer}
          depth={0}
          groups={groups}
          isExpanded={isExpanded}
          onToggle={toggleNode}
          selectedId={selectedId}
          selectedIds={selectedIds}
          onSelect={onSelect}
        />
      ))}
    </ul>
  )
}

interface LayerNodeProps {
  layer: CanvasLayer
  depth: number
  groups: ReadonlyMap<string, CanvasLayer[]>
  isExpanded: (layer: CanvasLayer) => boolean
  onToggle: (layer: CanvasLayer) => void
  selectedId?: string
  selectedIds?: ReadonlySet<string>
  onSelect: (layer: CanvasLayer, additive: boolean) => void
}

function LayerNode({
  layer,
  depth,
  groups,
  isExpanded,
  onToggle,
  selectedId,
  selectedIds,
  onSelect,
}: LayerNodeProps) {
  const { t } = useMessages(panelMessages)
  const label = layer.label || `<${layer.tag}>`
  const selected = selectedId === layer.id || Boolean(selectedIds?.has(layer.id))
  const children = groups.get(layer.id)
  const hasChildren = Boolean(children?.length)
  const expanded = hasChildren && isExpanded(layer)

  return (
    <li className="min-w-0">
      <div
        className={`group flex h-6.5 min-w-0 items-center gap-0.5 rounded-md pe-1.5 text-xs transition-colors ${
          selected
            ? 'bg-(--canvas-selection-tint) font-medium text-(--canvas-selection-strong)'
            : 'text-ink-muted hover:bg-surface-subtle hover:text-ink'
        }`}
        style={{ paddingInlineStart: depth * 12 + 2 }}
      >
        {hasChildren ? (
          <button
            type="button"
            tabIndex={-1}
            aria-label={t(expanded ? '折叠图层' : '展开图层')}
            aria-expanded={expanded}
            className="inline-flex size-4.5 shrink-0 items-center justify-center rounded text-ink-muted/80 transition-colors hover:bg-foreground/8 hover:text-ink"
            onClick={(event) => {
              event.stopPropagation()
              onToggle(layer)
            }}
          >
            <ChevronRight
              size={11}
              className={`transition-transform duration-150 ${expanded ? 'rotate-90' : ''}`}
            />
          </button>
        ) : (
          <span aria-hidden="true" className="inline-block w-4.5 shrink-0" />
        )}
        <button
          type="button"
          aria-pressed={selected}
          data-layer-id={layer.id}
          data-primary={selectedId === layer.id || undefined}
          className="flex min-w-0 flex-1 items-center gap-1.5 py-0.5 text-start outline-none focus-visible:rounded focus-visible:ring-1 focus-visible:ring-(--canvas-selection)"
          onClick={(event) => onSelect(layer, event.shiftKey)}
        >
          <LayerIcon layer={layer} />
          <bdi className="min-w-0 flex-1 truncate">{label}</bdi>
          {hasChildren && !expanded && children ? (
            <span className="shrink-0 font-mono text-[10px] opacity-60 tabular-nums">
              {children.length}
            </span>
          ) : null}
        </button>
      </div>
      {expanded && children ? (
        <ul className="space-y-0.5">
          {children.map((child) => (
            <LayerNode
              key={child.id}
              layer={child}
              depth={depth + 1}
              groups={groups}
              isExpanded={isExpanded}
              onToggle={onToggle}
              selectedId={selectedId}
              selectedIds={selectedIds}
              onSelect={onSelect}
            />
          ))}
        </ul>
      ) : null}
    </li>
  )
}
