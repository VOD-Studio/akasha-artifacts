import type { CanvasLayer } from '@akasha/protocol'
import { ScrollArea } from '@akasha/ui/scroll-area'
import { Hash } from 'lucide-react'
import type { CanvasDocument, CanvasLocation } from '@/entities/artifact'
import { useMessages } from '@/shared/i18n'
import { LayerTree } from './LayerTree'
import { panelMessages } from './messages'

interface BoardInspectorTreeProps {
  document: CanvasDocument
  location: CanvasLocation | null
  layers: { layers: readonly CanvasLayer[]; truncated: boolean } | null
  layersAvailable: boolean
  selectedLayerId?: string
  selectedRuntimeIds?: ReadonlySet<string>
  onSelectLayer: (layer: CanvasLayer, additive: boolean) => void
  onNavigate: (location: CanvasLocation) => void
}

/** 仅列出当前页面的画板，并在选中的画板下展开该帧上报的图层树。 */
export function BoardInspectorTree({
  document,
  location,
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
  const activePage =
    document.pages.find((page) => page.id === location?.pageId) ?? document.pages[0]

  return (
    <section aria-label={t('页面、画板与图层')} className="h-full">
      <ScrollArea
        aria-label={t('页面、画板与图层')}
        tabIndex={-1}
        className="h-full [--v-scroll-area-padding:8px_14px] [--v-scroll-area-surface:var(--popover)]"
      >
        {activePage && activePage.boards.length > 0 ? (
          <ul className="flex flex-col gap-0.5">
            {activePage.boards.map((board) => {
              const current = activePage.id === location?.pageId && board.id === location?.boardId
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
                    onClick={() => onNavigate({ pageId: activePage.id, boardId: board.id })}
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
        ) : (
          <p className="px-2 py-1 text-xs text-ink-muted">{t('此页面没有画板')}</p>
        )}
      </ScrollArea>
    </section>
  )
}
