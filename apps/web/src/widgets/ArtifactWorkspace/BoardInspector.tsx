import {
  type Artifact,
  type ArtifactHandoffReference,
  type CanvasLayer,
  DESIGN_LAYER_BLOCK_PREFIX,
  type DesignLayer,
  STANDALONE_BOARD_ID,
  type Version,
} from '@akasha/protocol'
import { Badge } from '@akasha/ui/badge'
import { Button } from '@akasha/ui/button'
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle } from '@akasha/ui/sheet'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@akasha/ui/tabs'
import { useState } from 'react'
import { useSelectionStore } from '../../entities/selection/store'
import { useWorkspaceStore } from '../../entities/workspace/store'
import { ElementPickerButton } from '../../features/element-picker/ElementPickerButton'
import { PropsPanel } from '../../features/props-panel/PropsPanel'
import { ARTIFACT_TYPE_LABELS } from '../../shared/lib/format'
import {
  changeLayoutSelection,
  type LayoutSelection,
  layoutSelectionIds,
} from './canvas-arrangement'
import type { CanvasDocument, CanvasLocation } from './canvas-model'
import { DesignLayerLayout } from './DesignLayerLayout'
import { LayerTree } from './LayerTree'
import type { CanvasBoardEditing } from './useCanvasBoardEditing'
import type { CanvasTextTools } from './useInlineCanvasText'

/** 检查器定位已经保存的画板；元素仅来自同版本的图层选择。 */
export type BoardInspectorHandoff = (
  title: string,
  scope: Pick<ArtifactHandoffReference, 'pageId' | 'boardId' | 'element'>,
) => void

interface BoardInspectorProps {
  artifact: Artifact
  version: Version
  stateSnapshot: Record<string, unknown>
  document: CanvasDocument
  location: CanvasLocation | null
  readOnly: boolean
  canComment?: boolean
  /** 缺省时仍可读取图层源码；只为可改的头版本提供布局编辑器。 */
  editing?: CanvasBoardEditing
  /** 只有可写的头版本可从图层属性打开就地文字编辑。 */
  onEditText?: CanvasTextTools['edit']
  layers: { layers: readonly CanvasLayer[]; truncated: boolean } | null
  layersAvailable: boolean
  selectedLayerId?: string
  onHandoff?: BoardInspectorHandoff
  onAskAgent?: BoardInspectorHandoff
  /** 树选区包含运行时节点 id；传 null 清除已有图层选区。 */
  onSelectLayer: (layer: CanvasLayer | null) => void
  onStartPicking: () => void
  onNavigate: (location: CanvasLocation) => void
}

const EMPTY_PROPS: Record<string, unknown> = {}

/** 运行属性、版本源码与可持久化的原生图层布局分开处理。 */
export function BoardInspector({
  artifact,
  version,
  stateSnapshot,
  document,
  location,
  readOnly,
  canComment = true,
  editing,
  onEditText,
  layers,
  layersAvailable,
  selectedLayerId,
  onHandoff,
  onAskAgent,
  onSelectLayer,
  onStartPicking,
  onNavigate,
}: BoardInspectorProps) {
  const open = useWorkspaceStore((state) => state.inspectorTab === 'inspect')
  const setDrawer = useWorkspaceStore((state) => state.setInspectorTab)
  const page = document.pages.find((item) => item.id === location?.pageId)
  const board = page?.boards.find((item) => item.id === location?.boardId)
  const source = board && !board.generated ? board.source : version.source
  const layer = layers?.layers.find((entry) => entry.id === selectedLayerId)
  const excerpt = !board?.generated && layer ? locateSource(source, layer) : null
  const handoffElement = useSelectionStore((state) => {
    const scoped = state.layersByArtifact[artifact.publicId]
    const target = state.selectedByArtifact[artifact.publicId]
    if (
      !target ||
      scoped?.version !== version.version ||
      scoped.id !== layer?.id ||
      (target.boardId ?? STANDALONE_BOARD_ID) !== board?.id
    )
      return undefined
    return target
  })
  const selectedBlock = useSelectionStore((state) => {
    const target = state.selectedByArtifact[artifact.publicId]
    return target?.boardId === board?.id ? target?.blockId : undefined
  })
  const designLayer = board?.designLayers?.find(
    (item) => `${DESIGN_LAYER_BLOCK_PREFIX}${item.id}` === selectedBlock,
  )
  const runtimeLocation =
    excerpt && layer ? `源码 ${layer.sourceLoc} · 布局只读` : '运行图层 · 布局只读'
  const designLocation = editing ? '原生图层 · 可编辑布局' : '原生图层 · 只读'
  const noLayers = layers ? '此画板没有可检查的图层' : '正在加载图层…'
  const layerStatus = layersAvailable ? noLayers : '未保存的预览无法查看图层。'
  const readOnlyLabel = version.version === artifact.headVersion ? '只读' : '历史版本 · 只读'
  const [extraLayers, setExtraLayers] = useState<(LayoutSelection & { scope: string }) | null>(null)
  const scope = JSON.stringify([artifact.publicId, board?.id])
  const activeDesignSelection: LayoutSelection = {
    selected: designLayer?.id ?? null,
    selectedIds:
      extraLayers?.scope === scope && extraLayers.selected === designLayer?.id
        ? extraLayers.selectedIds
        : undefined,
  }
  const designIds =
    designLayer && board?.designLayers
      ? layoutSelectionIds(board.designLayers, activeDesignSelection)
      : null
  const selectedDesignLayers = board?.designLayers?.filter((item) => designIds?.has(item.id)) ?? []
  const selectedRuntimeIds =
    designIds &&
    new Set(
      layers?.layers
        .filter((entry) => entry.designId && designIds.has(entry.designId))
        .map((entry) => entry.id),
    )

  const selectLayer = (target: CanvasLayer, additive: boolean) => {
    const items = board?.designLayers
    if (!target.designId || !items?.some((item) => item.id === target.designId)) {
      setExtraLayers(null)
      onSelectLayer(target)
      return
    }
    const next = changeLayoutSelection(items, activeDesignSelection, target.designId, additive)
    setExtraLayers({ ...next, scope })
    const primary =
      next.selected === target.designId
        ? target
        : layers?.layers.find((entry) => entry.designId === next.selected)
    onSelectLayer(primary ?? null)
  }

  return (
    <Sheet modal={false} open={open} onOpenChange={(next) => setDrawer(next ? 'inspect' : null)}>
      <SheetContent
        id="design-inspector"
        size="sm"
        aria-describedby={undefined}
        onInteractOutside={(event) => event.preventDefault()}
        className="top-13 bottom-0 overflow-hidden"
      >
        <SheetHeader>
          <SheetTitle>检查器</SheetTitle>
        </SheetHeader>
        <SheetBody>
          <div className="space-y-4">
            <section aria-label="页面、画板与图层" className="border-b border-border pb-3">
              <div className="mb-2 flex items-center justify-between gap-2 text-sm font-medium">
                <h2>页面、画板与图层</h2>
                <div className="flex items-center gap-1.5">
                  {layersAvailable ? (
                    <ElementPickerButton
                      onStart={() => {
                        setExtraLayers(null)
                        onStartPicking()
                      }}
                    />
                  ) : null}
                  <Badge tone="neutral">v{version.version}</Badge>
                </div>
              </div>
              <div className="max-h-[min(20rem,42dvh)] space-y-1 overflow-auto">
                {document.pages.map((entry) => (
                  <details key={entry.id} open={entry.id === page?.id || undefined}>
                    <summary className="cursor-pointer rounded px-2 py-1 text-sm text-ink">
                      {entry.title}
                    </summary>
                    {entry.boards.length > 0 && (
                      <ul className="ml-3 border-l border-border pl-2">
                        {entry.boards.map((item) => {
                          const current = entry.id === page?.id && item.id === board?.id
                          return (
                            <li key={item.id}>
                              <Button
                                variant={current ? 'secondary' : 'ghost'}
                                size="sm"
                                className="w-full justify-start"
                                aria-pressed={current}
                                onClick={() => onNavigate({ pageId: entry.id, boardId: item.id })}
                              >
                                <span className="truncate">{item.title}</span>
                              </Button>
                              {current && (
                                <div className="ml-2 border-l border-border pl-2">
                                  {layers?.layers.length ? (
                                    <LayerTree
                                      layers={layers.layers}
                                      selectedId={selectedLayerId}
                                      selectedIds={selectedRuntimeIds ?? undefined}
                                      onSelect={selectLayer}
                                    />
                                  ) : (
                                    <p className="px-2 py-1 text-xs text-ink-muted">
                                      {layerStatus}
                                    </p>
                                  )}
                                  {layers?.truncated ? (
                                    <p className="px-2 py-1 text-xs text-ink-muted">
                                      仅显示前 240 个图层
                                    </p>
                                  ) : null}
                                </div>
                              )}
                            </li>
                          )
                        })}
                      </ul>
                    )}
                    {entry.boards.length === 0 && (
                      <p className="px-4 py-1 text-xs text-ink-muted">此页面没有画板</p>
                    )}
                  </details>
                ))}
              </div>
            </section>
            {readOnly && <p className="text-xs text-ink-muted">{readOnlyLabel}</p>}
            <Tabs defaultValue="properties">
              <TabsList aria-label="检查器选项">
                <TabsTrigger value="properties">属性</TabsTrigger>
                <TabsTrigger value="source">源码</TabsTrigger>
                <TabsTrigger value="runtime">运行参数</TabsTrigger>
              </TabsList>
              <TabsContent value="properties" className="pt-3">
                {board && (
                  <>
                    <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-2 text-sm">
                      <dt className="text-ink-muted">页面</dt>
                      <dd>{page?.title}</dd>
                      <dt className="text-ink-muted">画板</dt>
                      <dd>{board.title}</dd>
                      <dt className="text-ink-muted">视口</dt>
                      <dd>
                        {board.width} × {board.height}
                      </dd>
                      <dt className="text-ink-muted">内容</dt>
                      <dd>{ARTIFACT_TYPE_LABELS[board.type]}</dd>
                      {designLayer || layer ? (
                        <>
                          <dt className="text-ink-muted">图层</dt>
                          <dd>{layer?.label || designLayer?.id || `<${layer?.tag}>`}</dd>
                          <dt className="text-ink-muted">尺寸</dt>
                          <dd>
                            {designLayer
                              ? `${designLayer.width} × ${designLayer.height}`
                              : `${layer?.width} × ${layer?.height}`}{' '}
                            px
                          </dd>
                          <dt className="text-ink-muted">定位</dt>
                          <dd>{designLayer ? designLocation : runtimeLocation}</dd>
                        </>
                      ) : null}
                    </dl>
                    {designLayer && editing ? (
                      <DesignLayerLayout
                        key={`${scope}:${designLayer.id}`}
                        boardId={board.id}
                        layer={designLayer}
                        selected={selectedDesignLayers}
                        editing={editing}
                      />
                    ) : null}
                    {onEditText &&
                    (designLayer?.kind === 'text' || designLayer?.kind === 'note') ? (
                      <Button
                        className="mt-3 mr-1"
                        variant="outline"
                        size="sm"
                        onClick={(event) => {
                          const rect = event.currentTarget.getBoundingClientRect()
                          onEditText(board, designLayer, { x: rect.left, y: rect.top })
                        }}
                      >
                        编辑文字
                      </Button>
                    ) : null}
                    {layer && canComment ? (
                      <Button
                        className="mt-3"
                        variant="outline"
                        size="sm"
                        onClick={() => setDrawer('review')}
                      >
                        批注
                      </Button>
                    ) : null}
                    {onHandoff && page ? (
                      <Button
                        className="mt-3 ml-1"
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          onHandoff(`${page.title} / ${board.title}`, {
                            pageId: page.id,
                            boardId: board.id,
                            element: handoffElement
                              ? {
                                  blockId: handoffElement.blockId,
                                  selector: handoffElement.selector,
                                }
                              : undefined,
                          })
                        }
                      >
                        {handoffElement ? '移交对象' : '移交画板'}
                      </Button>
                    ) : null}
                    {onAskAgent && page && handoffElement ? (
                      <Button
                        className="mt-3 ml-1"
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          onAskAgent(`${page.title} / ${board.title}`, {
                            pageId: page.id,
                            boardId: board.id,
                            element: {
                              blockId: handoffElement.blockId,
                              selector: handoffElement.selector,
                              loc: handoffElement.loc,
                              textPreview: handoffElement.textPreview,
                            },
                          })
                        }
                      >
                        问 Agent
                      </Button>
                    ) : null}
                  </>
                )}
                {!board && <p className="py-2 text-sm text-ink-muted">选择画板以查看属性</p>}
              </TabsContent>
              <TabsContent value="source" className="space-y-2 pt-3">
                <BoardInspectorSource
                  designLayer={designLayer}
                  excerpt={excerpt}
                  sourceLoc={layer?.sourceLoc}
                  source={source}
                  scope={board && !board.generated ? '画板源码' : '作品源码'}
                  hasLayer={Boolean(layer)}
                />
              </TabsContent>
              <TabsContent value="runtime" className="space-y-2 pt-3">
                {!readOnly && (
                  <p className="text-xs text-ink-muted">调整仅影响运行状态，不会生成新版本。</p>
                )}
                <PropsPanel
                  artifactId={artifact.publicId}
                  projectId={artifact.projectId}
                  artifactType={artifact.type}
                  source={version.source}
                  stateSnapshot={readOnly ? EMPTY_PROPS : stateSnapshot}
                  readOnly={readOnly}
                  onFallbackToL1={() => setDrawer('review')}
                />
              </TabsContent>
            </Tabs>
          </div>
        </SheetBody>
      </SheetContent>
    </Sheet>
  )
}

interface SourceExcerpt {
  line: number
  firstLine: number
  lines: string[]
  before: string
  tag: string
  after: string
}

function BoardInspectorSource({
  designLayer,
  excerpt,
  sourceLoc,
  source,
  scope,
  hasLayer,
}: {
  designLayer?: DesignLayer
  excerpt: SourceExcerpt | null
  sourceLoc?: string
  source: string
  scope: '画板源码' | '作品源码'
  hasLayer: boolean
}) {
  if (designLayer) {
    return (
      <>
        <p className="text-xs text-ink-muted">原生图层 · {designLayer.id}</p>
        <pre className="max-h-72 overflow-auto rounded-md bg-muted p-3 text-xs leading-5">
          <code>{JSON.stringify(designLayer, null, 2)}</code>
        </pre>
      </>
    )
  }
  if (excerpt) {
    return (
      <>
        <p className="text-xs text-ink-muted">源码位置 {sourceLoc}</p>
        <pre className="max-h-72 overflow-auto rounded-md bg-muted p-3 text-xs leading-5">
          {excerpt.lines.map((text, index) => {
            const line = excerpt.firstLine + index
            const marked = line === excerpt.line
            return (
              <code className={`block ${marked ? 'bg-accent/10' : ''}`} key={line}>
                <span
                  aria-hidden="true"
                  className="mr-3 inline-block min-w-6 text-right text-ink-muted"
                >
                  {line}
                </span>
                {marked ? (
                  <>
                    {excerpt.before}
                    <mark className="rounded bg-accent/20 text-inherit">{excerpt.tag}</mark>
                    {excerpt.after}
                  </>
                ) : (
                  text || ' '
                )}
              </code>
            )
          })}
        </pre>
      </>
    )
  }
  return (
    <>
      <p className="text-xs text-ink-muted">
        {hasLayer ? `无法定位此图层的源码。以下为${scope}。` : scope}
      </p>
      <pre className="max-h-72 overflow-auto rounded-md bg-muted p-3 text-xs leading-5">
        <code>{source}</code>
      </pre>
    </>
  )
}

function locateSource(source: string, layer: CanvasLayer): SourceExcerpt | null {
  if (!layer.sourceLoc) return null
  const [rawLine, rawColumn] = layer.sourceLoc.split(':')
  const line = Number(rawLine)
  const column = Number(rawColumn)
  if (line < 1 || column < 1) return null
  const all = source.split(/\r?\n/)
  const sourceLine = all[line - 1]
  const match = sourceLine?.slice(column - 1).match(/^<([\w:-]+)/)
  if (!sourceLine || match?.[1]?.toLowerCase() !== layer.tag.toLowerCase()) return null
  const firstLine = Math.max(1, line - 3)
  const start = column - 1
  const end = start + match[0].length
  const after = sourceLine.slice(end, end + 160)
  return {
    line,
    firstLine,
    lines: all.slice(firstLine - 1, line + 3),
    before: start > 18 ? `…${sourceLine.slice(start - 18, start)}` : sourceLine.slice(0, start),
    tag: match[0],
    after: end + after.length < sourceLine.length ? `${after}…` : after,
  }
}
