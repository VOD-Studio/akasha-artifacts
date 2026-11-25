import {
  type Artifact,
  type ArtifactHandoffReference,
  type CanvasLayer,
  type CanvasLayerStyles,
  DESIGN_LAYER_BLOCK_PREFIX,
  STANDALONE_BOARD_ID,
  type VersionSummary,
} from '@akasha/protocol'
import { Button } from '@akasha/ui/button'
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle } from '@akasha/ui/sheet'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@akasha/ui/tabs'
import { useEffect, useMemo, useState } from 'react'
import {
  type CanvasDocument,
  type CanvasLocation,
  hasVersionSource,
  type LoadedCanvasBoard,
  useArtifactSourceQuery,
  useArtifactSpecQuery,
} from '@/entities/artifact'
import { selectionForVersion, useSelectionStore } from '@/entities/selection'
import { useWorkspaceStore } from '@/entities/workspace'
import { extractPropFieldsFromSpec, PropsPanel } from '@/features/props-panel'
import { getRequestErrorMessage, isResourceUnavailable } from '@/shared/api/error'
import { useMessages } from '@/shared/i18n'
import { BoardInspectorProperties } from './BoardInspectorProperties'
import { BoardInspectorSource } from './BoardInspectorSource'
import { BoardInspectorTree } from './BoardInspectorTree'
import { BoardLayerStyles } from './BoardLayerStyles'
import { BoardTweakPanel } from './BoardTweakPanel'
import type { BoardTweakPreviewStore } from './board-tweak-previews'
import {
  changeLayoutSelection,
  type LayoutSelection,
  layoutSelectionIds,
} from './canvas-arrangement'
import { panelMessages } from './messages'
import type { CanvasBoardEditing } from './useCanvasBoardEditing'
import type { CanvasTextTools } from './useInlineCanvasText'

/** 检查器定位已经保存的画板；元素仅来自同版本的图层选择。 */
export type BoardInspectorHandoff = (
  title: string,
  scope: Pick<ArtifactHandoffReference, 'pageId' | 'boardId' | 'element'>,
) => void

interface BoardInspectorProps {
  artifact: Artifact
  version: VersionSummary
  loadedBoard?: LoadedCanvasBoard
  boardReadError?: string
  onRequestBoard?: (id?: string) => void
  onRetryBoard?: (id: string) => void
  stateSnapshot: Record<string, unknown>
  document: CanvasDocument
  location: CanvasLocation | null
  readOnly: boolean
  /** 分享编辑者能保存版本，但作品模板的状态流仍归作品所有者。 */
  templateReadOnly: boolean
  tweakPreviews: BoardTweakPreviewStore
  onOpenEditor?: () => void
  /** 当前头版本可暂保原生稳定选区，等新版沙盒重绑；固定版本不能继承旧选区。 */
  followHead: boolean
  canComment?: boolean
  /** 缺省时仍可读取图层源码；只为可改的头版本提供布局编辑器。 */
  editing?: CanvasBoardEditing
  /** 只有可写的头版本可从图层属性打开就地文字编辑。 */
  onEditText?: CanvasTextTools['edit']
  tab: string
  onTabChange: (tab: string) => void
  layers: { layers: readonly CanvasLayer[]; truncated: boolean; styles?: CanvasLayerStyles } | null
  layersAvailable: boolean
  selectedLayerId?: string
  onHandoff?: BoardInspectorHandoff
  onAskAgent?: BoardInspectorHandoff
  /** 树选区包含运行时节点 id；传 null 清除已有图层选区。 */
  onSelectLayer: (layer: CanvasLayer | null) => void
  onNavigate: (location: CanvasLocation) => void
}

const EMPTY_PROPS: Record<string, unknown> = {}

/** 运行属性、版本源码与可持久化的原生图层布局分开处理。 */
export function BoardInspector({
  artifact,
  loadedBoard,
  boardReadError,
  onRequestBoard,
  onRetryBoard,
  version,
  stateSnapshot,
  document,
  location,
  readOnly,
  templateReadOnly,
  tweakPreviews,
  onOpenEditor,
  followHead,
  canComment = true,
  editing,
  onEditText,
  tab,
  onTabChange,
  layers,
  layersAvailable,
  selectedLayerId,
  onHandoff,
  onAskAgent,
  onSelectLayer,
  onNavigate,
}: BoardInspectorProps) {
  const { t, dir } = useMessages(panelMessages)
  const open = useWorkspaceStore((state) => state.inspectorTab === 'inspect')
  const setDrawer = useWorkspaceStore((state) => state.setInspectorTab)
  const page = document.pages.find((item) => item.id === location?.pageId)
  const layout = page?.boards.find((item) => item.id === location?.boardId)
  const loaded = layout && loadedBoard?.id === layout.id ? loadedBoard : undefined
  const board = loaded ?? layout
  const layer = layers?.layers.find((entry) => entry.id === selectedLayerId)
  const inspectorBoardId =
    open && layout?.scoped && layout.source === undefined ? layout.id : undefined
  useEffect(() => {
    if (inspectorBoardId === undefined || !onRequestBoard) return
    onRequestBoard(inspectorBoardId)
    return () => onRequestBoard(undefined)
  }, [inspectorBoardId, onRequestBoard])
  const tweaks = layersAvailable ? loaded?.tweaks : undefined
  const template = useArtifactSpecQuery(artifact.type, open)
  const hasTemplateProps = useMemo(
    () => extractPropFieldsFromSpec(template.data).length > 0,
    [template.data],
  )
  const unavailableTab =
    (tab === 'tweaks' && !tweaks?.length) || (tab === 'template' && !hasTemplateProps)
  const usesBoardSource = Boolean(board?.scoped && !board.generated)
  const inline = hasVersionSource(version) ? version.source : undefined
  const sourceRead = useArtifactSourceQuery(
    artifact.publicId,
    version.version,
    open &&
      inline === undefined &&
      ((tab === 'template' && hasTemplateProps) || (tab === 'source' && !usesBoardSource)),
  )
  const fullSource = inline ?? sourceRead.data?.source
  const sourceReady = usesBoardSource ? board?.source !== undefined : fullSource !== undefined
  const sourceError = sourceRead.error ? getRequestErrorMessage(sourceRead.error) : undefined
  const retrySource = isResourceUnavailable(sourceRead.error)
    ? undefined
    : () => void sourceRead.refetch()
  const retryBoard =
    inspectorBoardId !== undefined && onRetryBoard
      ? () => onRetryBoard(inspectorBoardId)
      : undefined
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
    const scope = state.layersByArtifact[artifact.publicId]
    const target = state.selectedByArtifact[artifact.publicId]
    if (!target || target.boardId !== board?.id) return undefined
    if (selectionForVersion(state, artifact.publicId, version.version)) return target.blockId
    if (
      followHead &&
      scope &&
      scope.version < version.version &&
      target.blockId?.startsWith(DESIGN_LAYER_BLOCK_PREFIX)
    )
      return target.blockId
    return undefined
  })
  const designLayer = board?.designLayers?.find(
    (item) => `${DESIGN_LAYER_BLOCK_PREFIX}${item.id}` === selectedBlock,
  )
  const readOnlyLabel = version.version === artifact.headVersion ? t('只读') : t('历史版本 · 只读')
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

  const navigate = (next: CanvasLocation) => {
    setExtraLayers(null)
    onNavigate(next)
  }

  return (
    <Sheet modal={false} open={open} onOpenChange={(next) => setDrawer(next ? 'inspect' : null)}>
      <SheetContent
        side={dir === 'rtl' ? 'left' : 'right'}
        id="design-inspector"
        size="sm"
        aria-describedby={undefined}
        onInteractOutside={(event) => event.preventDefault()}
        className="top-13 bottom-0 overflow-hidden"
      >
        <SheetHeader>
          <SheetTitle>{t('检查器')}</SheetTitle>
        </SheetHeader>
        <SheetBody>
          <div className="flex flex-col gap-4">
            <BoardInspectorTree
              document={document}
              location={location}
              version={version.version}
              layers={layers}
              layersAvailable={layersAvailable}
              selectedLayerId={selectedLayerId}
              selectedRuntimeIds={selectedRuntimeIds ?? undefined}
              onSelectLayer={selectLayer}
              onNavigate={navigate}
            />
            {readOnly && <p className="text-xs text-ink-muted">{readOnlyLabel}</p>}
            <Tabs dir={dir} value={unavailableTab ? 'properties' : tab} onValueChange={onTabChange}>
              <TabsList aria-label={t('检查器选项')}>
                <TabsTrigger value="properties">{t('属性')}</TabsTrigger>
                <TabsTrigger value="source">{t('源码')}</TabsTrigger>
                {Boolean(tweaks?.length) && (
                  <TabsTrigger value="tweaks">{t('画板参数')}</TabsTrigger>
                )}
                {hasTemplateProps && <TabsTrigger value="template">{t('模板参数')}</TabsTrigger>}
              </TabsList>
              <TabsContent value="properties" className="pt-3">
                {board && (
                  <>
                    <BoardInspectorProperties
                      key={JSON.stringify([scope, designLayer?.id])}
                      board={board}
                      pageTitle={page?.title}
                      designLayer={designLayer}
                      runtimeLayer={layer}
                      selectedDesignLayers={selectedDesignLayers}
                      editing={readOnly || board.source === undefined ? undefined : editing}
                      onEditText={readOnly ? undefined : onEditText}
                    />
                    {(layer || designLayer) && canComment ? (
                      <Button
                        className="mt-3"
                        variant="outline"
                        size="sm"
                        onClick={() => setDrawer('review')}
                      >
                        {t('批注')}
                      </Button>
                    ) : null}
                    {onHandoff && page ? (
                      <Button
                        className="mt-3 ms-1"
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
                        {handoffElement ? t('移交对象') : t('移交画板')}
                      </Button>
                    ) : null}
                    {onAskAgent && page && handoffElement ? (
                      <Button
                        className="mt-3 ms-1"
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
                        {t('问 Agent')}
                      </Button>
                    ) : null}
                  </>
                )}
                {!board && <p className="py-2 text-sm text-ink-muted">{t('选择画板以查看属性')}</p>}
              </TabsContent>
              <TabsContent value="source" className="space-y-4 pt-3">
                {board && layer && <BoardLayerStyles layerId={layer.id} styles={layers?.styles} />}
                <h3 className="text-sm font-medium">{t('原始源码')}</h3>
                {sourceReady || designLayer ? (
                  <BoardInspectorSource
                    board={board}
                    version={version}
                    fullSource={fullSource}
                    designLayer={designLayer}
                    runtimeLayer={layer}
                    onOpenEditor={!readOnly && followHead ? onOpenEditor : undefined}
                  />
                ) : (
                  <InspectorSourceStatus
                    error={usesBoardSource ? boardReadError : sourceError}
                    retry={usesBoardSource ? retryBoard : retrySource}
                  />
                )}
              </TabsContent>
              {board && tweaks && tweaks.length > 0 && (
                <TabsContent value="tweaks" className="pt-3">
                  <BoardTweakPanel
                    key={board.id}
                    boardId={board.id}
                    tweaks={tweaks}
                    previews={tweakPreviews}
                  />
                </TabsContent>
              )}
              {hasTemplateProps && (
                <TabsContent value="template" className="flex flex-col gap-2 pt-3">
                  {!templateReadOnly && (
                    <p className="text-xs text-ink-muted">
                      {t('更改整份作品的运行状态，不会生成版本。')}
                    </p>
                  )}
                  {fullSource !== undefined ? (
                    <PropsPanel
                      artifactId={artifact.publicId}
                      projectId={artifact.projectId}
                      artifactType={artifact.type}
                      source={fullSource}
                      stateSnapshot={
                        version.version === artifact.headVersion ? stateSnapshot : EMPTY_PROPS
                      }
                      readOnly={templateReadOnly}
                      specOverride={template.data}
                    />
                  ) : (
                    <InspectorSourceStatus error={sourceError} retry={retrySource} />
                  )}
                </TabsContent>
              )}
            </Tabs>
          </div>
        </SheetBody>
      </SheetContent>
    </Sheet>
  )
}

interface InspectorSourceStatusProps {
  error?: string
  retry?: () => void
}

function InspectorSourceStatus({ error, retry }: InspectorSourceStatusProps) {
  const { t } = useMessages(panelMessages)
  if (error === undefined)
    return (
      <p className="text-xs text-ink-muted" role="status">
        {t('正在读取源码…')}
      </p>
    )
  return (
    <div role="alert" className="space-y-2 text-xs">
      <p>{t('源码读取失败：{error}', { error })}</p>
      {retry && (
        <Button size="sm" variant="outline" onClick={retry}>
          {t('重试')}
        </Button>
      )}
    </div>
  )
}
