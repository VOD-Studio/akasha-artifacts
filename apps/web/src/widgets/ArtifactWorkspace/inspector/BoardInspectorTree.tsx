import type { CanvasLayer } from '@akasha/protocol'
import { Badge } from '@akasha/ui/badge'
import { ScrollArea } from '@akasha/ui/scroll-area'
import { ChevronRight, Hash } from 'lucide-react'
import { useState } from 'react'
import type { CanvasDocument, CanvasLocation } from '@/entities/artifact'
import { useMessages } from '@/shared/i18n'
import { LayerTree } from './LayerTree'
import { panelMessages } from './messages'

interface BoardInspectorTreeProps {
  document: CanvasDocument
  location: CanvasLocation | null
  version: number
  layers: { layers: readonly CanvasLayer[]; truncated: boolean } | null
  layersAvailable: boolean
  selectedLayerId?: string
  selectedRuntimeIds?: ReadonlySet<string>
  onSelectLayer: (layer: CanvasLayer, additive: boolean) => void
  onNavigate: (location: CanvasLocation) => void
}

/** 页面以下列出画板，仅在当前画板下显示该帧上报的图层。 */
export function BoardInspectorTree({
  document,
  location,
  version,
  layers,
  layersAvailable,
  selectedLayerId,
  selectedRuntimeIds,
  onSelectLayer,
  onNavigate,
}: BoardInspectorTreeProps) {
  const { t } = useMessages(panelMessages)
  const [pageToggles, setPageToggles] = useState<ReadonlyMap<string, boolean>>(() => new Map())
  const noLayers = layers ? t('此画板没有可检查的图层') : t('正在加载图层…')
  const layerStatus = layersAvailable ? noLayers : t('未保存的预览无法查看图层。')

  const isPageOpen = (pageId: string) => {
    const manual = pageToggles.get(pageId)
    if (manual !== undefined) return manual
    return pageId === location?.pageId
  }

  const togglePage = (pageId: string) => {
    const open = isPageOpen(pageId)
    setPageToggles((prev) => new Map(prev).set(pageId, !open))
  }

  return (
    <section aria-label={t('页面、画板与图层')} className="border-b border-border/80 pb-3">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <h2 className="text-xs font-semibold text-ink-muted">{t('页面、画板与图层')}</h2>
        <Badge tone="neutral" className="font-mono tabular-nums">
          v{version}
        </Badge>
      </div>
      <ScrollArea
        aria-label={t('页面、画板与图层')}
        tabIndex={-1}
        className="max-h-[min(17rem,36dvh)] [--v-scroll-area-padding:0px] [--v-scroll-area-surface:var(--popover)]"
      >
        <div className="flex flex-col gap-0.5 pe-2">
          {document.pages.map((page) => {
            const expanded = isPageOpen(page.id)
            return (
              <div key={page.id} className="min-w-0">
                <button
                  type="button"
                  aria-expanded={expanded}
                  className="flex h-7 w-full min-w-0 items-center gap-1 rounded-md px-1 text-start text-xs font-medium text-ink transition-colors hover:bg-surface-subtle"
                  onClick={() => togglePage(page.id)}
                >
                  <ChevronRight
                    size={12}
                    className={`shrink-0 text-ink-muted transition-transform duration-150 ${
                      expanded ? 'rotate-90' : ''
                    }`}
                  />
                  <span className="min-w-0 flex-1 truncate">{page.title}</span>
                  <span className="shrink-0 font-mono text-[10px] text-ink-muted tabular-nums">
                    {page.boards.length}
                  </span>
                </button>
                {expanded && page.boards.length > 0 && (
                  <ul className="ms-2.5 mt-0.5 space-y-0.5 border-s border-border/70 ps-1.5">
                    {page.boards.map((board) => {
                      const current = page.id === location?.pageId && board.id === location?.boardId
                      return (
                        <li key={board.id} className="min-w-0">
                          <button
                            type="button"
                            aria-pressed={current}
                            className={`flex h-7 w-full min-w-0 items-center gap-1.5 rounded-md px-2 text-start text-xs transition-colors ${
                              current
                                ? 'bg-(--canvas-selection-tint) font-medium text-(--canvas-selection-strong)'
                                : 'text-ink-muted hover:bg-surface-subtle hover:text-ink'
                            }`}
                            onClick={() => onNavigate({ pageId: page.id, boardId: board.id })}
                          >
                            <Hash size={12} className="shrink-0 opacity-70" />
                            <span className="min-w-0 flex-1 truncate">{board.title}</span>
                          </button>
                          {current && (
                            <div className="ms-2 mt-0.5 border-s border-border/60 ps-1">
                              {layers?.layers.length ? (
                                <LayerTree
                                  layers={layers.layers}
                                  selectedId={selectedLayerId}
                                  selectedIds={selectedRuntimeIds}
                                  onSelect={onSelectLayer}
                                />
                              ) : (
                                <p className="px-2 py-1 text-xs text-ink-muted">{layerStatus}</p>
                              )}
                              {layers?.truncated && (
                                <p className="px-2 py-1 text-xs text-ink-muted">
                                  {t('仅显示前 {count} 个图层', { count: 240 })}
                                </p>
                              )}
                            </div>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                )}
                {expanded && page.boards.length === 0 && (
                  <p className="px-5 py-1 text-xs text-ink-muted">{t('此页面没有画板')}</p>
                )}
              </div>
            )
          })}
        </div>
      </ScrollArea>
    </section>
  )
}
