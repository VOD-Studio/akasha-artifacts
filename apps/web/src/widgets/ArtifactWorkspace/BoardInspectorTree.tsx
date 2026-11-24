import type { CanvasLayer } from '@akasha/protocol'
import { Badge } from '@akasha/ui/badge'
import { Button } from '@akasha/ui/button'
import type { CanvasDocument, CanvasLocation } from '@/entities/artifact'
import { ElementPickerButton } from '@/features/element-picker'
import { LayerTree } from './LayerTree'

interface BoardInspectorTreeProps {
  document: CanvasDocument
  location: CanvasLocation | null
  version: number
  layers: { layers: readonly CanvasLayer[]; truncated: boolean } | null
  layersAvailable: boolean
  selectedLayerId?: string
  selectedRuntimeIds?: ReadonlySet<string>
  onSelectLayer: (layer: CanvasLayer, additive: boolean) => void
  onStartPicking: () => void
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
  onStartPicking,
  onNavigate,
}: BoardInspectorTreeProps) {
  const noLayers = layers ? '此画板没有可检查的图层' : '正在加载图层…'
  const layerStatus = layersAvailable ? noLayers : '未保存的预览无法查看图层。'
  return (
    <section aria-label="页面、画板与图层" className="border-b border-border pb-3">
      <div className="mb-2 flex items-center justify-between gap-2 text-sm font-medium">
        <h2>页面、画板与图层</h2>
        <div className="flex items-center gap-1.5">
          {layersAvailable && <ElementPickerButton onStart={onStartPicking} />}
          <Badge tone="neutral">v{version}</Badge>
        </div>
      </div>
      <div className="flex max-h-[min(20rem,42dvh)] flex-col gap-1 overflow-auto">
        {document.pages.map((page) => (
          <details key={page.id} open={page.id === location?.pageId || undefined}>
            <summary className="cursor-pointer rounded px-2 py-1 text-sm text-ink">
              {page.title}
            </summary>
            {page.boards.length > 0 && (
              <ul className="ms-3 border-s border-border ps-2">
                {page.boards.map((board) => {
                  const current = page.id === location?.pageId && board.id === location?.boardId
                  return (
                    <li key={board.id}>
                      <Button
                        variant={current ? 'secondary' : 'ghost'}
                        size="sm"
                        className="w-full justify-start"
                        aria-pressed={current}
                        onClick={() => onNavigate({ pageId: page.id, boardId: board.id })}
                      >
                        <span className="truncate">{board.title}</span>
                      </Button>
                      {current && (
                        <div className="ms-2 border-s border-border ps-2">
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
                            <p className="px-2 py-1 text-xs text-ink-muted">仅显示前 240 个图层</p>
                          )}
                        </div>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
            {page.boards.length === 0 && (
              <p className="px-4 py-1 text-xs text-ink-muted">此页面没有画板</p>
            )}
          </details>
        ))}
      </div>
    </section>
  )
}
