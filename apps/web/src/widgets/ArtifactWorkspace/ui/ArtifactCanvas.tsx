import type {
  CanvasElementPresentation,
  CanvasLayer,
  DesignLayer,
  EditOp,
  ElementRef,
  VersionSummary,
} from '@akasha/protocol'
import { Button } from '@akasha/ui/button'
import { ListHighlight } from '@akasha/ui/list-highlight'
import {
  type MouseEvent,
  type ReactNode,
  type Ref,
  type RefObject,
  useEffect,
  useEffectEvent,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type {
  CanvasBoard,
  CanvasBounds,
  CanvasDocument,
  CanvasLocation,
  CanvasPage,
} from '@/entities/artifact'
import type { CanvasExportSelection } from '@/features/export-design'
import type { VisualEditTarget } from '@/features/visual-edit'
import { useMessages } from '@/shared/i18n'
import { useBoardGesture } from '../hooks/useBoardGesture'
import { useBoardPresentation } from '../hooks/useBoardPresentation'
import type { CanvasBoardEditing } from '../hooks/useCanvasBoardEditing'
import { useCanvasCameraInput } from '../hooks/useCanvasCameraInput'
import { useCanvasKeyboardEditing } from '../hooks/useCanvasKeyboardEditing'
import { useCanvasMarquee } from '../hooks/useCanvasMarquee'
import { useCanvasShortcuts } from '../hooks/useCanvasShortcuts'
import { useCanvasView } from '../hooks/useCanvasView'
import type { CanvasTextTools } from '../hooks/useInlineCanvasText'
import { useOverviewPlayback } from '../hooks/useOverviewPlayback'
import { useViewportSize } from '../hooks/useViewportSize'
import { fitSelection } from '../lib/canvas-arrangement'
import { type Camera, fitCamera, type Point, zoomCamera } from '../lib/canvas-camera'
import { indexViewportBoards, MAX_ANIMATED_BOARDS, planViewport } from '../lib/canvas-viewport'
import type { CanvasPageEditing } from '../navigation/CanvasPageDialog'
import { CanvasPlaybackMenu } from '../navigation/CanvasPlaybackMenu'
import { PageNavigator } from '../navigation/PageNavigator'
import { CanvasArrangeMenu } from '../toolbar/CanvasArrangeMenu'
import {
  CanvasBoardActions,
  CanvasBoardEditNotice,
  CanvasBoardQuickActions,
} from '../toolbar/CanvasBoardActions'
import { CanvasToolbar } from '../toolbar/CanvasControls'
import { canvasToolsMessages } from '../toolbar/canvas-tools-messages'
import type { BoardFramePurpose } from './ArtifactFrame'
import type { DrawingTool } from './BoardDrawingSurface'
import { BoardPresentation } from './BoardPresentation'
import { type CanvasBoardInput, CanvasBoardSurface } from './CanvasBoardSurface'
import { CanvasBoardTile } from './CanvasBoardTile'
import { CanvasFlowLines } from './CanvasFlowLines'
import { CanvasArtboardPlacer, CanvasBlankDrawingOverlay } from './CanvasPlacementOverlay'

/** 显式选板要求适配；元素指认与图层选择只在画板不可见时移动相机。 */
export type InspectorReveal = CanvasLocation & { fit?: true }

/** 画布内当前选中图层的键盘导航与直改上下文。 */
export interface CanvasLayerSelectionContext {
  board?: CanvasBoard
  layers: readonly CanvasLayer[]
  selectedLayer?: CanvasLayer
  selectedDesignLayer?: DesignLayer
  selectedElement: ElementRef | null
  presentation: CanvasElementPresentation | null
  visualTarget: VisualEditTarget | null
  onSelectLayer: (layer: CanvasLayer | null, shouldReveal?: boolean) => void
  onEnterBoard: (boardId: string) => void
  onApplyRuntimeOp: (op: EditOp) => Promise<boolean>
  readFullSource: () => Promise<string | null>
  /** 从标题按 Return 进入图层时递增，触发把键盘焦点移到图层宿主。 */
  focusToken: number
}

/** 选区浮栏的定位和焦点回调。 */
export interface SelectionToolbarAnchor {
  toolbarRef: RefObject<HTMLElement | null>
  /** 选中对象在画布视口内的屏幕坐标包围盒。 */
  rect: CanvasBounds
  viewport: { width: number; height: number }
  returnFocusToTarget: () => void
  onFlip: (axis: 'horizontal' | 'vertical') => void
  onReorderFlow: (delta: -1 | 1) => void
}

interface ArtifactCanvasProps {
  document: CanvasDocument
  visible: boolean
  /** 相机与选中画板的本地存储键。 */
  storageKey: string
  /** 链接里 `#page=…&board=…` 形式的定位；只在进入时定位一次。 */
  address: string
  onClearAddress?: () => void
  /** 生成指向某个页面的链接，用于导航与分享。 */
  pageLink: (pageId: string) => string
  /** 只在可保存画布页面的头版本传入。 */
  pageEditing?: CanvasPageEditing
  boardEditing?: CanvasBoardEditing
  /** 同一份版本历史也可供单板 HTML 或 React 的文字直改使用。 */
  historyEditing?: CanvasBoardEditing
  /** 缺省时双击不启用文字直改，原型仍只从播放入口进入。 */
  textTools?: CanvasTextTools
  /** 抽屉选板后定位；换工具不消费尚不可见的请求。 */
  reveal?: InspectorReveal | null
  onRevealHandled: () => void
  onLocationChange: (location: CanvasLocation | null) => void
  onSelectPoint?: (boardId: string, point: Point) => void
  onClearElement: () => void
  onComment: (anchor?: { x: number; y: number }) => void
  /** 用该画板的稳定标识打开和制品共用的导出面板。 */
  onExportBoard?: (boardId: string) => void
  exportVersion: VersionSummary
  exportSelectionRef?: Ref<() => CanvasExportSelection | undefined>
  renderBoard: (board: CanvasBoard, purpose: BoardFramePurpose, detailed: boolean) => ReactNode
  /** 渲染画板边界之外的原生图层溢出，允许点击选中所属图层。 */
  renderBoardOverflow?: (board: CanvasBoard, scale: number, interactive: boolean) => ReactNode
  /** 选中画板内图层时提供键盘层级导航与直改上下文。 */
  layerSelection?: CanvasLayerSelectionContext
  /** 渲染贴靠当前选区的浮动工具栏。 */
  renderSelectionToolbar?: (anchor: SelectionToolbarAnchor) => ReactNode
  /** 从最新的可见范围提交优先队列，不把占位板或遗留选区当成加载需求。 */
  onDemandChange: (ids: readonly string[], idle: boolean) => void
  canPlay: (board: CanvasBoard) => boolean
  canAnimate: (board: CanvasBoard) => boolean
  /** 可视化直改的开关；省略时画布不提供直改入口。 */
  visualEdit?: { isPicking: boolean; toggle: () => void; cancel: () => void }
}

function resolveSelectedLayerRect(
  layerSelection: CanvasLayerSelectionContext | undefined,
  boardBounds: CanvasBounds,
  camera: Camera,
): { rect: CanvasBounds; label: string } {
  const design = layerSelection?.selectedDesignLayer
  const elemRect = layerSelection?.selectedElement?.rect
  let localRect: CanvasBounds = {
    x: 0,
    y: 0,
    width: boardBounds.width,
    height: boardBounds.height,
  }
  if (design) {
    localRect = { x: design.x, y: design.y, width: design.width, height: design.height }
  } else if (elemRect && elemRect.width > 0 && elemRect.height > 0) {
    localRect = elemRect
  }
  let label = layerSelection?.selectedLayer?.label || layerSelection?.selectedLayer?.tag || ''
  if (!label && design) {
    label =
      design.kind === 'text' || design.kind === 'note'
        ? design.text.trim().slice(0, 40) || design.kind
        : design.kind
  }
  return {
    rect: {
      x: camera.x + (boardBounds.x + localRect.x) * camera.scale,
      y: camera.y + (boardBounds.y + localRect.y) * camera.scale,
      width: Math.max(8, localRect.width * camera.scale),
      height: Math.max(8, localRect.height * camera.scale),
    },
    label,
  }
}

const NO_MOTION: ReadonlySet<string> = new Set()
const isPrototype = (board: CanvasBoard) => board.type === 'html' || board.type === 'react'

export function ArtifactCanvas({
  document,
  visible,
  storageKey,
  address,
  onClearAddress,
  pageLink,
  pageEditing,
  boardEditing,
  historyEditing = boardEditing,
  textTools,
  reveal,
  onRevealHandled,
  onLocationChange,
  onSelectPoint,
  onClearElement,
  onComment,
  onExportBoard,
  exportVersion,
  exportSelectionRef,
  renderBoard,
  renderBoardOverflow,
  layerSelection,
  renderSelectionToolbar,
  onDemandChange,
  canPlay,
  canAnimate,
  visualEdit,
}: ArtifactCanvasProps) {
  const { t, dir } = useMessages(canvasToolsMessages)
  const viewportRef = useRef<HTMLElement>(null)
  const layerFocusRef = useRef<HTMLButtonElement>(null)
  const selectionToolbarRef = useRef<HTMLElement>(null)
  const pendingKeyboardFocus = useRef<string | null>(null)
  const [keyboardBoard, setKeyboardBoard] = useState<string | null>(null)
  const [navigatorOpen, setNavigatorOpen] = useState(false)
  const [copyStatus, setCopyStatus] = useState('')
  const [blankNotice, setBlankNotice] = useState('')
  const [hiddenGuideBoards, setHiddenGuideBoards] = useState<ReadonlySet<string>>(() => new Set())
  const [drawingTool, setDrawingTool] = useState<DrawingTool | null>(null)
  const [artboardPlacing, setArtboardPlacing] = useState(false)
  const [drawingDragging, setDrawingDragging] = useState(false)
  const presentation = useBoardPresentation(document, visible)
  const showOverview = visible && !presentation.focused && !presentation.playing
  const motion = useOverviewPlayback()
  const size = useViewportSize(viewportRef, showOverview)
  const measurable = showOverview && size.width > 0 && size.height > 0

  const {
    page,
    pageId,
    overview,
    addressedPage,
    invalidAddress,
    selected,
    activeSelection,
    firstBoard,
    layout,
    camera,
    hand,
    setHand,
    selectBoard,
    selectBoards,
    updateCamera,
    clearAddress,
    navigate: navigateView,
  } = useCanvasView({
    document,
    address,
    storageKey,
    measurable,
    size,
    onClearAddress,
    onAddressChange: () => setCopyStatus(''),
    onShareFocus: (pageId, boardId) => presentation.openFocus({ pageId, boardId }, null),
  })
  const showBoards = !invalidAddress && page && page.boards.length > 0
  const standalone = firstBoard && !firstBoard.scoped ? firstBoard : undefined
  const { artifactId, version } = exportVersion
  useImperativeHandle(
    exportSelectionRef,
    () => () =>
      pageId !== undefined && activeSelection.size > 0
        ? { artifactId, version, pageId, columns: document.columns, boardIds: [...activeSelection] }
        : undefined,
    [activeSelection, artifactId, document.columns, pageId, version],
  )
  const selectedBoards = useMemo(
    () => (page?.boards ?? []).filter((board) => activeSelection.has(board.id)),
    [page, activeSelection],
  )
  const guideBoard = selectedBoards.length === 1 ? selectedBoards[0] : undefined
  const toggleSelectedGuides = () => {
    if (!guideBoard) return
    setHiddenGuideBoards((previous) => {
      const next = new Set(previous)
      if (!next.delete(guideBoard.id)) next.add(guideBoard.id)
      return next
    })
  }
  const viewportIndex = useMemo(
    () => indexViewportBoards(page?.boards ?? [], layout.bounds),
    [page?.boards, layout.bounds],
  )

  const inspectedFocus = presentation.focused ? presentation.focus : null
  useEffect(() => {
    onLocationChange(
      inspectedFocus ??
        (pageId === undefined || invalidAddress
          ? null
          : { pageId, boardId: selected ?? undefined }),
    )
  }, [inspectedFocus, invalidAddress, onLocationChange, pageId, selected])

  const navigate = (target: CanvasPage, boardId?: string | null) => {
    navigateView(target, boardId)
    setDrawingTool(null)
    setArtboardPlacing(false)
    setDrawingDragging(false)
    setBlankNotice('')
    setNavigatorOpen(false)
    setCopyStatus('')
  }

  const revealFromInspector = useEffectEvent((target: InspectorReveal) => {
    const page = document.pages.find((item) => item.id === target.pageId)
    if (!page || (target.boardId && !page.boards.some((item) => item.id === target.boardId))) return
    presentation.dismiss()
    if (!target.fit && target.pageId === pageId && !invalidAddress) {
      const bounds = target.boardId ? layout.bounds.get(target.boardId) : undefined
      const left = bounds ? camera.x + bounds.x * camera.scale : 0
      const top = bounds ? camera.y + bounds.y * camera.scale : 0
      if (
        !bounds ||
        !measurable ||
        (left < size.width &&
          top < size.height &&
          left + bounds.width * camera.scale > 0 &&
          top + bounds.height * camera.scale > 0)
      ) {
        if (target.boardId !== selected) selectBoard(target.boardId ?? null)
        return
      }
    }
    navigate(page, target.boardId)
  })
  useEffect(() => {
    if (!visible || !reveal) return
    onRevealHandled()
    revealFromInspector(reveal)
  }, [onRevealHandled, reveal, visible])

  const boardGesture = useBoardGesture(
    boardEditing,
    { page, bounds: layout.bounds, selection: activeSelection, scale: camera.scale },
    (boardId) => {
      if (!activeSelection.has(boardId)) selectBoard(boardId)
      updateCamera((current) => (current.fit ? { ...current, fit: null } : current))
    },
  )
  const moved = boardGesture.preview?.pageId === pageId ? boardGesture.preview?.bounds : undefined
  const focused = presentation.focused
  const activePresentation = presentation.playing ?? focused
  const closePresentation = presentation.playing ? presentation.closePlay : presentation.closeFocus
  const hasSelectedLayer = Boolean(
    layerSelection?.selectedLayer || layerSelection?.selectedDesignLayer,
  )
  const keyboardEditing = useCanvasKeyboardEditing({
    visible: showOverview,
    viewportRef,
    layerFocusRef,
    selectionToolbarRef,
    page,
    selectedBoards,
    boardBounds: layout.bounds,
    activeBoard: layerSelection?.board,
    layers: layerSelection?.layers ?? [],
    selectedLayer: layerSelection?.selectedLayer,
    selectedDesignLayer: layerSelection?.selectedDesignLayer,
    visualTarget: layerSelection?.visualTarget ?? null,
    editing: boardEditing,
    canEditBoards: Boolean(boardEditing),
    canEditRuntime: Boolean(historyEditing?.available),
    versionNumber: version,
    readFullSource: layerSelection?.readFullSource ?? (async () => null),
    onSelectLayer: layerSelection?.onSelectLayer ?? (() => {}),
    onSelectBoard: (id) => selectBoard(id),
    onApplyRuntimeOp: layerSelection?.onApplyRuntimeOp ?? (async () => false),
  })
  const focusToken = layerSelection?.focusToken ?? 0
  useEffect(() => {
    if (!focusToken || !showOverview) return
    layerFocusRef.current?.focus({ preventScroll: true })
  }, [focusToken, showOverview])

  const { space, modifier, resetModifiers } = useCanvasShortcuts({
    visible,
    viewportRef,
    navigatorOpen,
    closePresentation: activePresentation ? closePresentation : undefined,
    historyEditing,
    cancelGesture: () => {
      boardGesture.cancel()
      marquee.cancel()
    },
    clearSelection: () => {
      if (drawingTool || artboardPlacing || hand) {
        setDrawingTool(null)
        setArtboardPlacing(false)
        setDrawingDragging(false)
        setBlankNotice('')
        setHand(false)
        visualEdit?.cancel()
        return
      }
      if (hasSelectedLayer && selected) {
        onClearElement()
        keyboardEditing.focusBoardTitle(selected)
        return
      }
      setBlankNotice('')
      onClearElement()
      visualEdit?.cancel()
      selectBoard(null)
    },
  })
  const handActive = hand || space
  const marquee = useCanvasMarquee({
    enabled: Boolean(
      showOverview &&
        !handActive &&
        !modifier &&
        !drawingTool &&
        !artboardPlacing &&
        !visualEdit?.isPicking &&
        !invalidAddress &&
        page &&
        !standalone,
    ),
    boards: page?.boards ?? [],
    bounds: layout.bounds,
    camera,
    onCommit: (ids, additive) => {
      onClearElement()
      selectBoards(ids, additive)
    },
  })
  const { dragging, wheelActive, wasPinching, startPointer, movePointer, endPointer } =
    useCanvasCameraInput({
      viewportRef,
      showOverview,
      size,
      invalidAddress,
      pageId,
      handActive,
      wheelLocked: Boolean(
        drawingDragging || boardGesture.preview?.phase === 'dragging' || marquee.active,
      ),
      updateCamera,
    })
  const recent = useRef<{ index: typeof viewportIndex; ids: ReadonlySet<string> } | null>(null)
  const plan = useMemo(
    () =>
      planViewport(
        viewportIndex,
        camera,
        size,
        selected ?? firstBoard?.id ?? null,
        keyboardBoard,
        moved,
        showOverview && recent.current?.index === viewportIndex ? recent.current.ids : undefined,
      ),
    [viewportIndex, camera, size, selected, firstBoard?.id, keyboardBoard, moved, showOverview],
  )
  useLayoutEffect(() => {
    recent.current = showOverview ? { index: viewportIndex, ids: plan.runtime } : null
  }, [showOverview, viewportIndex, plan.runtime])
  const animatedIds = useMemo(() => {
    if (!showOverview || !motion.allowsAnimation) return NO_MOTION
    const ids = new Set<string>()
    for (const id of plan.detail) {
      const board = viewportIndex.byId.get(id)?.board
      if (board && canAnimate(board)) ids.add(id)
      if (ids.size === MAX_ANIMATED_BOARDS) break
    }
    return ids
  }, [showOverview, motion.allowsAnimation, plan.detail, viewportIndex, canAnimate])
  const demand = useMemo(() => {
    if (!visible || invalidAddress) return []
    if (activePresentation)
      return activePresentation.source === undefined ? [activePresentation.id] : []
    return plan.detail
  }, [visible, invalidAddress, activePresentation, plan.detail])
  const idle = showOverview && !dragging && !wheelActive && !moved
  useLayoutEffect(() => {
    onDemandChange(demand, idle)
  }, [demand, idle, onDemandChange])
  useLayoutEffect(() => {
    const next = pendingKeyboardFocus.current
    if (!next || !showOverview || !plan.boards.some((board) => board.id === next)) return
    for (const title of viewportRef.current?.querySelectorAll<HTMLButtonElement>(
      '.artifact-canvas-board-title',
    ) ?? []) {
      if (title.dataset.boardId !== next) continue
      pendingKeyboardFocus.current = null
      title.focus({ preventScroll: true })
      break
    }
  }, [plan.boards, showOverview])
  const boundsFor = (id: string) => moved?.get(id) ?? layout.bounds.get(id)
  const selectedLayerBoardBounds = layerSelection?.board?.id
    ? boundsFor(layerSelection.board.id)
    : undefined
  const selectedLayerOverlay =
    showOverview && hasSelectedLayer && selectedLayerBoardBounds
      ? resolveSelectedLayerRect(layerSelection, selectedLayerBoardBounds, camera)
      : null
  const canDragBoards =
    boardEditing?.available &&
    !handActive &&
    !modifier &&
    !drawingTool &&
    !artboardPlacing &&
    !visualEdit?.isPicking

  const setCanvasTool = (next: boolean) => {
    boardGesture.cancel()
    marquee.cancel()
    setDrawingTool(null)
    setArtboardPlacing(false)
    setDrawingDragging(false)
    setBlankNotice('')
    setHand(next)
    visualEdit?.cancel()
  }

  const pauseCanvasTools = () => {
    boardGesture.cancel()
    marquee.cancel()
    setDrawingTool(null)
    setArtboardPlacing(false)
    setDrawingDragging(false)
    setBlankNotice('')
    setNavigatorOpen(false)
    resetModifiers()
    visualEdit?.cancel()
  }

  const selectionBounds = useMemo(
    () => fitSelection(selectedBoards.flatMap((board) => layout.bounds.get(board.id) ?? [])),
    [selectedBoards, layout.bounds],
  )
  const zoom = (factor: number) =>
    updateCamera((current) =>
      zoomCamera(current, factor, { x: size.width / 2, y: size.height / 2 }),
    )

  const openFromMenu = (boardId: string, trigger: HTMLButtonElement, play: boolean) => {
    if (!page) return
    pauseCanvasTools()
    const target = { pageId: page.id, boardId }
    if (play) presentation.openPlay(target, trigger)
    else presentation.openFocus(target, trigger)
  }
  const inputFor = (board: CanvasBoard, interactive: boolean): CanvasBoardInput => {
    if (handActive || modifier) return 'gesture'
    if (showOverview && board.scoped && boardEditing?.available && drawingTool) {
      return { tool: drawingTool, editing: boardEditing }
    }
    return interactive ? 'interactive' : 'select'
  }
  const activateTitle = (boardId: string, event: MouseEvent<HTMLButtonElement>) => {
    if (boardGesture.consumesClick(event) || (handActive && event.detail !== 0)) return
    onClearElement()
    selectBoard(boardId, event.shiftKey)
  }
  const focusTitle = (boardId: string, element: HTMLButtonElement, bounds: CanvasBounds) => {
    setKeyboardBoard(boardId)
    if (!measurable || !element.matches(':focus-visible')) return
    const viewport = viewportRef.current?.getBoundingClientRect()
    const title = element.getBoundingClientRect()
    if (
      viewport &&
      (title.right < viewport.left ||
        title.left > viewport.right ||
        title.bottom < viewport.top ||
        title.top > viewport.bottom)
    ) {
      updateCamera(() => fitCamera(bounds, size, null))
    }
  }
  const clickBackground = (event: MouseEvent<HTMLElement>) => {
    if (marquee.consumeBackgroundClick()) return
    if (
      event.target !== event.currentTarget ||
      handActive ||
      wasPinching.current ||
      drawingTool ||
      artboardPlacing
    )
      return
    onClearElement()
    selectBoard(null)
  }

  let activeTool = 'select'
  if (handActive) activeTool = 'hand'
  else if (artboardPlacing) activeTool = 'artboard'
  else if (drawingTool) activeTool = drawingTool.kind
  else if (visualEdit?.isPicking) activeTool = 'pick'

  return (
    <>
      <div hidden={!showOverview} className={showOverview ? 'artifact-canvas-shell' : 'hidden'}>
        <div className="artifact-canvas-navigation">
          <ListHighlight>
            <div className="artifact-canvas-nav-bar">
              <PageNavigator
                open={navigatorOpen && showOverview}
                onOpenChange={setNavigatorOpen}
                pages={document.pages}
                page={invalidAddress ? undefined : page}
                selected={selected}
                onNavigate={(page, boardId) => {
                  onClearElement()
                  navigate(page, boardId)
                }}
                pageLink={pageLink}
                pageEditing={pageEditing}
                status={copyStatus}
                onStatus={setCopyStatus}
              />
              {!invalidAddress && page && page.boards.length > 0 ? (
                <>
                  <span aria-hidden="true" className="mx-0.5 h-3.5 w-px shrink-0 bg-border/90" />
                  <CanvasPlaybackMenu
                    boards={page.boards}
                    canPlay={canPlay}
                    canAnimate={canAnimate}
                    paused={motion.paused}
                    onTogglePause={motion.togglePause}
                    onOpen={(id, trigger) => openFromMenu(id, trigger, false)}
                    onPlay={(id, trigger) => openFromMenu(id, trigger, true)}
                  />
                </>
              ) : null}
            </div>
          </ListHighlight>
          {historyEditing ? <CanvasBoardEditNotice editing={historyEditing} /> : null}
          {blankNotice ? (
            <p
              role="status"
              className="mt-1 max-w-xs rounded-8 border border-border bg-surface px-3 py-2 text-xs text-ink shadow-xs"
            >
              {blankNotice}
            </p>
          ) : null}
        </div>
        {/* biome-ignore lint/a11y/useKeyWithClickEvents: 键盘用 Escape 清空同一选区；点击这里只处理空白。 */}
        <section
          ref={viewportRef}
          dir="ltr"
          aria-label={t('画布')}
          tabIndex={-1}
          className="artifact-canvas"
          data-tool={activeTool}
          data-hand={handActive}
          data-dragging={dragging}
          data-marquee={marquee.box ? 'true' : undefined}
          onPointerDown={(event) => {
            if (marquee.onPointerDown(event)) return
            startPointer(event)
          }}
          onPointerMove={(event) => {
            if (marquee.onPointerMove(event)) return
            movePointer(event)
          }}
          onPointerUp={(event) => {
            if (marquee.onPointerUp(event)) return
            endPointer(event)
          }}
          onPointerCancel={(event) => {
            marquee.cancel()
            endPointer(event)
          }}
          onLostPointerCapture={(event) => {
            marquee.cancel()
            endPointer(event)
          }}
          onClick={clickBackground}
        >
          {showOverview &&
          !invalidAddress &&
          page &&
          drawingTool &&
          boardEditing?.available &&
          !standalone ? (
            <CanvasBlankDrawingOverlay
              key={drawingTool.kind}
              tool={drawingTool}
              camera={camera}
              boards={page.boards}
              bounds={layout.bounds}
              version={boardEditing.version}
              onDraggingChange={setDrawingDragging}
              onUnowned={() => {
                setBlankNotice(t('空白画布区域不保存游离图层，请落入画板或跨越画板边界。'))
                setDrawingTool(null)
              }}
              onCreate={(targetBoard, layer, base, anchor) => {
                setBlankNotice('')
                selectBoard(targetBoard.id)
                setDrawingTool(null)
                if (layer.kind === 'text' || layer.kind === 'note') {
                  textTools?.place(targetBoard, layer, base, anchor)
                } else {
                  boardEditing.change({ kind: 'layerCreate', boardId: targetBoard.id, layer }, base)
                }
              }}
            />
          ) : null}
          {invalidAddress && (
            <div dir={dir} className="artifact-canvas-message">
              <p role="alert">{t(addressedPage ? '链接中的画板不存在' : '链接中的页面不存在')}</p>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  const target = addressedPage ?? overview
                  if (target) navigate(target, null)
                  else clearAddress()
                }}
              >
                {t(addressedPage ? '返回页面' : '返回总览')}
              </Button>
            </div>
          )}
          {showBoards && (
            <>
              <CanvasFlowLines
                document={document}
                bounds={layout.bounds}
                moved={moved}
                camera={camera}
              />
              {(standalone ? [standalone] : plan.boards).map((board) => {
                const bounds = boundsFor(board.id)
                if (!bounds) return null
                const detailed =
                  (showOverview && plan.runtime.has(board.id)) ||
                  (board === standalone && !activePresentation)
                const interactive =
                  !handActive &&
                  detailed &&
                  board === standalone &&
                  (!isPrototype(board) || Boolean(visualEdit?.isPicking))
                const tileSelected =
                  activeSelection.has(board.id) || marquee.previewIds.has(board.id)
                return (
                  <CanvasBoardTile
                    key={board.id}
                    board={board}
                    page={page}
                    bounds={bounds}
                    camera={camera}
                    isSelected={tileSelected}
                    primary={selected === board.id}
                    canDrag={Boolean(canDragBoards)}
                    gesture={boardGesture}
                    onSelectTitle={activateTitle}
                    onFocusTitle={focusTitle}
                    onEnterBoard={
                      layerSelection
                        ? (boardId) => {
                            selectBoard(boardId)
                            layerSelection.onEnterBoard(boardId)
                          }
                        : undefined
                    }
                    onNavigate={(id) => {
                      pendingKeyboardFocus.current = id
                      onClearElement()
                      navigate(page, id)
                    }}
                    overflow={
                      renderBoardOverflow?.(
                        board,
                        camera.scale,
                        !handActive && !drawingTool && !artboardPlacing && !visualEdit?.isPicking,
                      ) ?? null
                    }
                    actions={
                      <>
                        {board === standalone && visualEdit && (
                          <Button
                            variant={visualEdit.isPicking ? 'secondary' : 'ghost'}
                            size="sm"
                            aria-pressed={visualEdit.isPicking}
                            onClick={() => {
                              setHand(false)
                              setDrawingTool(null)
                              setArtboardPlacing(false)
                              visualEdit.toggle()
                            }}
                          >
                            {t('编辑元素')}
                          </Button>
                        )}
                        <CanvasBoardQuickActions
                          title={board.title}
                          onExpand={(event) => openFromMenu(board.id, event.currentTarget, false)}
                          onPlay={
                            isPrototype(board) && canPlay(board)
                              ? (event) => openFromMenu(board.id, event.currentTarget, true)
                              : undefined
                          }
                          onExport={onExportBoard ? () => onExportBoard(board.id) : undefined}
                        />
                        {boardEditing ? (
                          <CanvasBoardActions
                            board={board}
                            bounds={bounds}
                            version={boardEditing.version}
                            disabled={!boardEditing.available}
                            onChange={boardEditing.change}
                          />
                        ) : null}
                      </>
                    }
                  >
                    <CanvasBoardSurface
                      board={board}
                      scale={camera.scale}
                      showGuides={!hiddenGuideBoards.has(board.id)}
                      input={inputFor(board, interactive)}
                      textTools={textTools}
                      wasPinching={wasPinching}
                      selectBoard={selectBoard}
                      onClearElement={onClearElement}
                      onSelectPoint={detailed ? onSelectPoint : undefined}
                      onDrawingEnd={() => {
                        setDrawingTool(null)
                        setDrawingDragging(false)
                        setBlankNotice('')
                      }}
                      onDraggingChange={setDrawingDragging}
                    >
                      {renderBoard(
                        board,
                        {
                          type: 'overview',
                          interactive,
                          animate: !board.scoped || animatedIds.has(board.id),
                        },
                        detailed,
                      )}
                    </CanvasBoardSurface>
                  </CanvasBoardTile>
                )
              })}
            </>
          )}
          {!invalidAddress && !showBoards && (
            <p dir={dir} className="artifact-canvas-message text-sm text-ink-muted">
              {t('此页面没有画板')}
            </p>
          )}
          {marquee.box ? (
            <div
              data-testid="canvas-marquee"
              aria-hidden="true"
              className="artifact-canvas-marquee"
              style={{
                left: marquee.box.x,
                top: marquee.box.y,
                width: marquee.box.width,
                height: marquee.box.height,
              }}
            />
          ) : null}
          {showOverview && hasSelectedLayer && selectedLayerBoardBounds && (
            <>
              <button
                ref={layerFocusRef}
                type="button"
                data-testid="canvas-layer-focus"
                className="artifact-canvas-layer-focus"
                aria-label={t(
                  '当前图层：{label}（Tab 遍历，Return 进入，Shift+Return 退一层，F6 选区工具栏，Esc 回板）',
                  { label: selectedLayerOverlay?.label || t('画布') },
                )}
                style={
                  selectedLayerOverlay
                    ? {
                        left: selectedLayerOverlay.rect.x,
                        top: selectedLayerOverlay.rect.y,
                        width: selectedLayerOverlay.rect.width,
                        height: selectedLayerOverlay.rect.height,
                      }
                    : undefined
                }
                onKeyDown={keyboardEditing.onLayerKeyDown}
              />
              {selectedLayerOverlay &&
                renderSelectionToolbar?.({
                  toolbarRef: selectionToolbarRef,
                  rect: selectedLayerOverlay.rect,
                  viewport: size,
                  returnFocusToTarget: () => {
                    if (layerFocusRef.current) {
                      layerFocusRef.current.focus({ preventScroll: true })
                    } else if (layerSelection?.board?.id) {
                      keyboardEditing.focusBoardTitle(layerSelection.board.id)
                    }
                  },
                  onFlip: (axis) => void keyboardEditing.flipSelection(axis),
                  onReorderFlow: (delta) => void keyboardEditing.reorderSelectedFlow(delta),
                })}
            </>
          )}
          {artboardPlacing && boardEditing && page && !invalidAddress ? (
            <CanvasArtboardPlacer
              camera={camera}
              version={boardEditing.version}
              size={size}
              onDraggingChange={setDrawingDragging}
              onCancel={() => setArtboardPlacing(false)}
              onPlace={(bounds, base) => {
                setArtboardPlacing(false)
                setBlankNotice('')
                const id = crypto.randomUUID()
                void boardEditing
                  .change(
                    {
                      kind: 'create',
                      id,
                      title: t('画板 {index}', { index: page.boards.length + 1 }),
                      pageId: page.id,
                      bounds,
                    },
                    base,
                  )
                  .then((ok) => {
                    if (ok) selectBoard(id)
                  })
              }}
            />
          ) : null}
        </section>
        <CanvasToolbar
          camera={camera}
          guidesVisible={guideBoard ? !hiddenGuideBoards.has(guideBoard.id) : undefined}
          onToggleGuides={guideBoard ? toggleSelectedGuides : undefined}
          hand={hand}
          onChangeTool={setCanvasTool}
          designTools={
            boardEditing && page?.boards.length && !invalidAddress
              ? {
                  value: drawingTool,
                  disabled: !boardEditing.available,
                  change: (tool) => {
                    setCanvasTool(false)
                    setDrawingTool(tool)
                  },
                }
              : undefined
          }
          artboardTool={
            boardEditing && page && !invalidAddress
              ? {
                  active: artboardPlacing,
                  disabled: !boardEditing.available,
                  toggle: () => {
                    if (artboardPlacing) {
                      setArtboardPlacing(false)
                    } else {
                      setCanvasTool(false)
                      setArtboardPlacing(true)
                    }
                  },
                }
              : undefined
          }
          onComment={() => {
            const layerRect = layerFocusRef.current?.getBoundingClientRect()
            if (layerRect && (layerRect.width > 0 || layerRect.height > 0)) {
              onComment({ x: layerRect.right + 12, y: layerRect.top })
              return
            }
            const titleEl = selected
              ? Array.from(
                  viewportRef.current?.querySelectorAll<HTMLButtonElement>(
                    '.artifact-canvas-board-title',
                  ) ?? [],
                ).find((el) => el.dataset.boardId === selected)
              : undefined
            const titleRect = titleEl?.getBoundingClientRect()
            if (titleRect && (titleRect.width > 0 || titleRect.height > 0)) {
              onComment({ x: titleRect.left, y: titleRect.bottom + 8 })
              return
            }
            onComment(hasSelectedLayer || selected ? { x: 120, y: 120 } : undefined)
          }}
          history={historyEditing}
          arrangementMenu={
            boardEditing ? (
              <CanvasArrangeMenu
                selected={selectedBoards}
                bounds={layout.bounds}
                editing={boardEditing}
              />
            ) : null
          }
          canZoom={Boolean(page?.boards.length && !invalidAddress)}
          onZoom={zoom}
          onFitPage={
            measurable && page?.boards.length && !invalidAddress
              ? () => updateCamera(() => fitCamera(layout.page, size, 'page'))
              : undefined
          }
          onFitSelection={
            measurable && selectionBounds
              ? () => updateCamera(() => fitCamera(selectionBounds, size, 'board'))
              : undefined
          }
          visualEditActive={visualEdit?.isPicking}
        />
      </div>
      {presentation.focus && focused ? (
        <BoardPresentation
          key={`focus:${JSON.stringify(presentation.focus)}`}
          board={focused}
          visible={visible && !presentation.playing}
          onClose={presentation.closeFocus}
          onExport={onExportBoard ? () => onExportBoard(focused.id) : undefined}
          onPlay={
            canPlay(focused)
              ? (event) => {
                  if (presentation.focus)
                    presentation.openPlay(presentation.focus, event.currentTarget)
                }
              : undefined
          }
        >
          {visible && !presentation.playing ? renderBoard(focused, { type: 'focus' }, true) : null}
        </BoardPresentation>
      ) : null}
      {visible && presentation.play && presentation.playing ? (
        <BoardPresentation
          key={`play:${JSON.stringify(presentation.play)}`}
          board={presentation.playing}
          playback
          onClose={presentation.closePlay}
        >
          {renderBoard(
            presentation.playing,
            presentation.playing.presentation?.interactive === false
              ? { type: 'focus' }
              : { type: 'play', onNavigate: presentation.navigate, onExit: presentation.closePlay },
            true,
          )}
        </BoardPresentation>
      ) : null}
    </>
  )
}
