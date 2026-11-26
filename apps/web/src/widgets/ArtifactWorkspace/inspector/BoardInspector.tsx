import {
  type ArtboardTweakValues,
  type Artifact,
  type ArtifactHandoffReference,
  type CanvasElementPresentation,
  type CanvasLayer,
  type CanvasLayerStyles,
  DESIGN_LAYER_BLOCK_PREFIX,
  type EditOp,
  type ElementRect,
  type ElementRef,
  STANDALONE_BOARD_ID,
  type VersionSummary,
} from '@akasha/protocol'
import { Button } from '@akasha/ui/button'
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle } from '@akasha/ui/sheet'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@akasha/ui/tabs'
import { type PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
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
import type { VisualEditTarget } from '@/features/visual-edit'
import { getRequestErrorMessage, isResourceUnavailable } from '@/shared/api/error'
import { useMessages } from '@/shared/i18n'
import type { CanvasBoardEditing } from '../hooks/useCanvasBoardEditing'
import type { CanvasTextTools } from '../hooks/useInlineCanvasText'
import {
  changeLayoutSelection,
  type LayoutSelection,
  layoutSelectionIds,
} from '../lib/canvas-arrangement'
import type { BoardTweakPreviewStore } from '../model/board-tweak-previews'
import { InspectorSection } from '../ui/inspector-controls'
import { BoardInspectorProperties } from './BoardInspectorProperties'
import { BoardInspectorSource } from './BoardInspectorSource'
import { BoardInspectorTree } from './BoardInspectorTree'
import { BoardLayerStyles } from './BoardLayerStyles'
import { BoardTweakApplyDialog } from './BoardTweakApplyDialog'
import { BoardTweakPanel } from './BoardTweakPanel'
import { tweakApplyMessages } from './board-tweak-apply-messages'
import { panelMessages } from './messages'

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
  /** 说明只读成因，便于在未授权会话或只读身份下前置给出明确提示。 */
  readOnlyReason?: 'historical' | 'local-auth' | 'permission' | 'shared'
  /** 分享编辑者能保存版本，但作品模板的状态流仍归作品所有者。 */
  templateReadOnly: boolean
  tweakPreviews: BoardTweakPreviewStore
  onOpenEditor?: () => void
  /** 当前头版本可暂保原生稳定选区，等新版沙盒重绑；固定版本不能继承旧选区。 */
  followHead: boolean
  canComment?: boolean
  /** 缺省时仍可读取图层源码；只为可改的头版本提供布局编辑器。 */
  editing?: CanvasBoardEditing
  /** 静态 HTML/React 元素直改使用的编辑控制器（单板 HTML 同样可用）。 */
  elementEditing?: CanvasBoardEditing
  /** 只有可写的头版本可从图层属性打开就地文字编辑。 */
  onEditText?: CanvasTextTools['edit']
  onEditSourceText?: CanvasTextTools['editSource']
  selectedElement?: ElementRef | null
  sourceLoc?: string
  presentation?: CanvasElementPresentation | null
  visualTarget?: VisualEditTarget | null
  onApplyRuntimeOp?: (op: EditOp) => Promise<boolean>
  readFullSource?: () => Promise<string | null | undefined>
  onHtmlElementSaved?: (
    boardId: string,
    loc: string,
    rect: ElementRect | undefined,
    version: number,
  ) => void
  tab: string
  onTabChange: (tab: string) => void
  advancedOpen?: boolean
  onAdvancedOpenChange?: (open: boolean) => void
  layers: { layers: readonly CanvasLayer[]; truncated: boolean; styles?: CanvasLayerStyles } | null
  layersAvailable: boolean
  selectedLayerId?: string
  onHandoff?: BoardInspectorHandoff
  onAskAgent?: BoardInspectorHandoff
  /** 受理参数请求后打开已绑定会话；不等同于发布版本。 */
  onOpenAgentConversation?: () => void
  /** 预览可供访客使用；发布画板默认值须以成员身份打开可写头版本。 */
  canPublishTweaks: boolean
  /** 树选区包含运行时节点 id；传 null 清除已有图层选区。 */
  onSelectLayer: (layer: CanvasLayer | null) => void
  onNavigate: (location: CanvasLocation) => void
}

const EMPTY_PROPS: Record<string, unknown> = {}
const DEFAULT_TREE_HEIGHT = 216
const MIN_TREE_HEIGHT = 96
const MIN_DETAIL_HEIGHT = 160

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
  readOnlyReason,
  templateReadOnly,
  tweakPreviews,
  onOpenEditor,
  followHead,
  canComment = true,
  editing,
  elementEditing,
  onEditText,
  onEditSourceText,
  selectedElement,
  sourceLoc,
  presentation,
  visualTarget,
  onApplyRuntimeOp,
  readFullSource,
  onHtmlElementSaved,
  tab,
  onTabChange,
  advancedOpen,
  onAdvancedOpenChange,
  layers,
  layersAvailable,
  selectedLayerId,
  onHandoff,
  onAskAgent,
  onOpenAgentConversation,
  canPublishTweaks,
  onSelectLayer,
  onNavigate,
}: BoardInspectorProps) {
  const { t, dir } = useMessages(panelMessages)
  const open = useWorkspaceStore((state) => state.inspectorTab === 'inspect')
  const setDrawer = useWorkspaceStore((state) => state.setInspectorTab)
  const { t: tweakText, locale } = useMessages(tweakApplyMessages)
  const [tweakRequest, setTweakRequest] = useState<{
    base: VersionSummary
    boardId: string
    values: ArtboardTweakValues
  } | null>(null)
  const allowTweakWrite = Boolean(editing && canPublishTweaks && layersAvailable)
  const requestIsCurrent =
    tweakRequest?.base.artifactId === artifact.publicId &&
    tweakRequest.base.version === version.version
  useEffect(() => {
    if (!tweakRequest || (open && tab === 'tweaks' && allowTweakWrite && requestIsCurrent)) return
    if (
      open &&
      allowTweakWrite &&
      tweakRequest.base.artifactId === artifact.publicId &&
      !requestIsCurrent
    )
      toast.info(
        tweakText('已基于 v{version} 打开，作品已更新。请重新选择。', {
          version: tweakRequest.base.version,
        }),
      )
    setTweakRequest(null)
  }, [allowTweakWrite, artifact.publicId, open, requestIsCurrent, tab, tweakRequest, tweakText])
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
  const hasBoardTweaks = Boolean(board && tweaks && tweaks.length > 0)
  const template = useArtifactSpecQuery(artifact.type, open)
  const hasTemplateProps = useMemo(
    () => extractPropFieldsFromSpec(template.data).length > 0,
    [template.data],
  )
  const hasTweaksTab = hasBoardTweaks || hasTemplateProps
  const normalizedTab = tab === 'template' ? 'tweaks' : tab
  const activeTab = normalizedTab === 'tweaks' && !hasTweaksTab ? 'properties' : normalizedTab
  const usesBoardSource = Boolean(board?.scoped && !board.generated)
  const inline = hasVersionSource(version) ? version.source : undefined
  const sourceRead = useArtifactSourceQuery(
    artifact.publicId,
    version.version,
    open &&
      inline === undefined &&
      ((activeTab === 'tweaks' && hasTemplateProps) ||
        (activeTab === 'source' && !usesBoardSource)),
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
  let readOnlyLabel = t('只读')
  if (readOnlyReason === 'historical' || version.version !== artifact.headVersion) {
    readOnlyLabel = t('历史版本 · 只读')
  } else if (readOnlyReason === 'local-auth') {
    readOnlyLabel = t('只读 · 缺少本机会话凭证，请通过 akasha open 打开')
  } else if (readOnlyReason === 'permission') {
    readOnlyLabel = t('只读 · 无编辑权限')
  }
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

  const splitRef = useRef<HTMLDivElement>(null)
  const [treeHeight, setTreeHeight] = useState(DEFAULT_TREE_HEIGHT)
  const [resizingTree, setResizingTree] = useState(false)

  const clampTreeHeight = (next: number) => {
    const containerHeight = splitRef.current?.clientHeight ?? 0
    const maxHeight =
      containerHeight > MIN_TREE_HEIGHT + MIN_DETAIL_HEIGHT
        ? containerHeight - MIN_DETAIL_HEIGHT
        : 480
    return Math.round(Math.min(Math.max(next, MIN_TREE_HEIGHT), maxHeight))
  }

  const startResizeTree = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    const target = event.currentTarget
    const startY = event.clientY
    const startHeight = treeHeight
    setResizingTree(true)
    target.setPointerCapture?.(event.pointerId)

    const onMove = (moveEvent: PointerEvent) => {
      setTreeHeight(clampTreeHeight(startHeight + moveEvent.clientY - startY))
    }
    const onEnd = () => {
      setResizingTree(false)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onEnd)
      window.removeEventListener('pointercancel', onEnd)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onEnd)
    window.addEventListener('pointercancel', onEnd)
  }

  return (
    <Sheet modal={false} open={open} onOpenChange={(next) => setDrawer(next ? 'inspect' : null)}>
      <SheetContent
        side={dir === 'rtl' ? 'left' : 'right'}
        id="design-inspector"
        size="sm"
        aria-describedby={undefined}
        onInteractOutside={(event) => event.preventDefault()}
        className="top-15 bottom-3 overflow-hidden"
      >
        <Tabs
          dir={dir}
          value={activeTab}
          onValueChange={onTabChange}
          className="flex min-h-0 flex-1 flex-col"
        >
          <SheetHeader>
            <SheetTitle className="sr-only">{t('检查器')}</SheetTitle>
            <TabsList aria-label={t('检查器选项')}>
              <TabsTrigger value="properties">{t('属性')}</TabsTrigger>
              <TabsTrigger value="source">{t('源码')}</TabsTrigger>
              {hasTweaksTab && <TabsTrigger value="tweaks">{t('参数')}</TabsTrigger>}
            </TabsList>
          </SheetHeader>
          <SheetBody className="min-h-0 flex-1">
            <div ref={splitRef} className="flex min-h-full flex-col">
              {activeTab !== 'tweaks' ? (
                <>
                  <div style={{ height: treeHeight }} className="shrink-0 overflow-hidden">
                    <BoardInspectorTree
                      document={document}
                      location={location}
                      layers={layers}
                      layersAvailable={layersAvailable}
                      selectedLayerId={selectedLayerId}
                      selectedRuntimeIds={selectedRuntimeIds ?? undefined}
                      onSelectLayer={selectLayer}
                      onNavigate={navigate}
                    />
                  </div>
                  <button
                    type="button"
                    aria-label={t('页面、画板与图层')}
                    data-testid="inspector-tree-resizer"
                    data-dragging={resizingTree ? 'true' : undefined}
                    className="group relative z-10 flex h-2 w-full shrink-0 cursor-row-resize touch-none items-center border-0 bg-transparent p-0 outline-none select-none focus-visible:outline-none"
                    onPointerDown={startResizeTree}
                    onDoubleClick={() => setTreeHeight(DEFAULT_TREE_HEIGHT)}
                    onKeyDown={(event) => {
                      if (event.key === 'ArrowUp') {
                        event.preventDefault()
                        setTreeHeight((prev) => clampTreeHeight(prev - 24))
                      } else if (event.key === 'ArrowDown') {
                        event.preventDefault()
                        setTreeHeight((prev) => clampTreeHeight(prev + 24))
                      }
                    }}
                  >
                    <span
                      aria-hidden="true"
                      className={`block w-full transition-colors ${
                        resizingTree
                          ? 'h-0.5 bg-(--canvas-selection)'
                          : 'h-px bg-border/80 group-hover:h-0.5 group-hover:bg-(--canvas-selection) group-focus-visible:h-0.5 group-focus-visible:bg-(--canvas-selection)'
                      }`}
                    />
                  </button>
                </>
              ) : null}
              {readOnly && (
                <p className="border-b border-border/75 px-4 py-2 text-xs text-ink-muted">
                  {readOnlyLabel}
                </p>
              )}
              <TabsContent value="properties" className="flex-1">
                {board && (
                  <>
                    <BoardInspectorProperties
                      key={
                        designLayer
                          ? JSON.stringify([scope, 'design', designLayer.id])
                          : JSON.stringify([scope, 'runtime', layer?.id, sourceLoc])
                      }
                      board={board}
                      pageTitle={page?.title}
                      designLayer={designLayer}
                      runtimeLayer={layer}
                      styles={layers?.styles}
                      advancedOpen={advancedOpen}
                      onAdvancedOpenChange={onAdvancedOpenChange}
                      selectedElement={
                        selectedElement &&
                        (selectedElement.boardId ?? STANDALONE_BOARD_ID) === board.id
                          ? selectedElement
                          : null
                      }
                      sourceLoc={sourceLoc}
                      presentation={presentation}
                      visualTarget={visualTarget}
                      selectedDesignLayers={selectedDesignLayers}
                      editing={readOnly || board.source === undefined ? undefined : editing}
                      elementEditing={readOnly ? undefined : (elementEditing ?? editing)}
                      onEditText={readOnly ? undefined : onEditText}
                      onEditSourceText={readOnly ? undefined : onEditSourceText}
                      onApplyRuntimeOp={readOnly ? undefined : onApplyRuntimeOp}
                      readFullSource={readFullSource}
                      onHtmlElementSaved={onHtmlElementSaved}
                    />
                    {((layer || designLayer || selectedElement) && canComment) ||
                    (onHandoff && page && handoffElement) ||
                    (onAskAgent && page && handoffElement) ? (
                      <div className="flex flex-wrap items-center gap-1.5 border-t border-border/75 px-4 py-3">
                        {(layer || designLayer || selectedElement) && canComment ? (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8 rounded-[8px] px-3 text-xs"
                            onClick={() => setDrawer('review')}
                          >
                            {t('批注')}
                          </Button>
                        ) : null}
                        {onHandoff && page && handoffElement ? (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8 rounded-[8px] px-3 text-xs"
                            onClick={() =>
                              onHandoff(`${page.title} / ${board.title}`, {
                                pageId: page.id,
                                boardId: board.id,
                                element: {
                                  blockId: handoffElement.blockId,
                                  selector: handoffElement.selector,
                                },
                              })
                            }
                          >
                            {t('移交对象')}
                          </Button>
                        ) : null}
                        {onAskAgent && page && handoffElement ? (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8 rounded-[8px] px-3 text-xs"
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
                      </div>
                    ) : null}
                  </>
                )}
                {!board && (
                  <div className="flex min-h-56 flex-col items-center justify-center px-4 py-10 text-center">
                    <p className="text-[13px] text-ink-muted">{t('选择画板以查看属性')}</p>
                  </div>
                )}
              </TabsContent>
              <TabsContent value="source">
                {board && layer && (
                  <BoardLayerStyles
                    layerId={layer.id}
                    tag={layer.tag}
                    label={layer.label}
                    styles={layers?.styles}
                  />
                )}
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
                  <div className="px-4 py-3.5">
                    <InspectorSourceStatus
                      error={usesBoardSource ? boardReadError : sourceError}
                      retry={usesBoardSource ? retryBoard : retrySource}
                    />
                  </div>
                )}
              </TabsContent>
              {hasTweaksTab && (
                <TabsContent value="tweaks" className="divide-y divide-border/75">
                  {hasBoardTweaks && board && tweaks && (
                    <InspectorSection title={t('画板参数')}>
                      <BoardTweakPanel
                        key={board.id}
                        boardId={board.id}
                        tweaks={tweaks}
                        previews={tweakPreviews}
                        onApply={
                          allowTweakWrite && editing?.available
                            ? (values) =>
                                setTweakRequest({ base: version, boardId: board.id, values })
                            : undefined
                        }
                      />
                    </InspectorSection>
                  )}
                  {hasTemplateProps && (
                    <div className="px-4 py-3.5">
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
                    </div>
                  )}
                </TabsContent>
              )}
            </div>
          </SheetBody>
        </Tabs>
      </SheetContent>
      {open && allowTweakWrite && requestIsCurrent && tweakRequest && editing && (
        <BoardTweakApplyDialog
          artifact={artifact}
          base={tweakRequest.base}
          boardId={tweakRequest.boardId}
          values={tweakRequest.values}
          agentAllowed={Boolean(onOpenAgentConversation)}
          onApply={editing.replaceSource}
          onApplied={(saved, titles) =>
            toast.success(
              tweakText('已发布 v{version}：{boards}', {
                version: saved.version,
                boards: new Intl.ListFormat(locale).format(titles),
              }),
            )
          }
          onAgentAccepted={() => {
            setTweakRequest(null)
            onOpenAgentConversation?.()
          }}
          onClose={() => setTweakRequest(null)}
        />
      )}
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
