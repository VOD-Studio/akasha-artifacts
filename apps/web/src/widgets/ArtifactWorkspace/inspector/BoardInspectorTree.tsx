import type { CanvasLayer } from '@akasha/protocol'
import { Badge } from '@akasha/ui/badge'
import { Button } from '@akasha/ui/button'
import { ScrollArea } from '@akasha/ui/scroll-area'
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
  const noLayers = layers ? t('此画板没有可检查的图层') : t('正在加载图层…')
  const layerStatus = layersAvailable ? noLayers : t('未保存的预览无法查看图层。')
  return (
    <section aria-label={t('页面、画板与图层')} className="border-b border-border/80 pb-3">
      <div className="mb-2 flex items-center justify-between gap-2">
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
          {document.pages.map((page) => (
            <details key={page.id} open={page.id === location?.pageId || undefined}>
              <summary className="cursor-pointer rounded-lg px-2 py-1 text-xs font-medium text-ink transition-colors hover:bg-surface-subtle">
                {page.title}
              </summary>
              {page.boards.length > 0 && (
                <ul className="ms-2.5 mt-0.5 space-y-0.5 border-s border-border/75 ps-2">
                  {page.boards.map((board) => {
                    const current = page.id === location?.pageId && board.id === location?.boardId
                    return (
                      <li key={board.id}>
                        <Button
                          variant="ghost"
                          size="sm"
                          className={
                            current
                              ? 'h-7 w-full justify-start rounded-lg bg-(--canvas-selection-tint) px-2 text-xs font-medium text-(--canvas-selection-strong) hover:bg-(--canvas-selection-tint)'
                              : 'h-7 w-full justify-start rounded-lg px-2 text-xs text-ink-muted hover:text-ink'
                          }
                          aria-pressed={current}
                          onClick={() => onNavigate({ pageId: page.id, boardId: board.id })}
                        >
                          <span className="truncate">{board.title}</span>
                        </Button>
                        {current && (
                          <div className="ms-2 mt-0.5 border-s border-border/75 ps-2">
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
              {page.boards.length === 0 && (
                <p className="px-4 py-1 text-xs text-ink-muted">{t('此页面没有画板')}</p>
              )}
            </details>
          ))}
        </div>
      </ScrollArea>
    </section>
  )
}
