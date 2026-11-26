import {
  type CanvasElementPresentation,
  type CanvasLayer,
  DEFAULT_ARTBOARD_APPEARANCE,
  type DesignLayer,
  type EditOp,
  type ElementRef,
  STANDALONE_BOARD_ID,
  type VersionSummary,
} from '@akasha/protocol'
import { Button } from '@akasha/ui/button'
import { ListHighlight } from '@akasha/ui/list-highlight'
import { MessageSquare } from 'lucide-react'
import {
  type MouseEvent,
  type PointerEvent,
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
import { CanvasPresence } from '@/features/canvas-presence'
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
import type { CanvasTextDraft, CanvasTextTools } from '../hooks/useInlineCanvasText'
import { useLayerGesture } from '../hooks/useLayerGesture'
import { useOverviewPlayback } from '../hooks/useOverviewPlayback'
import { useViewportSize } from '../hooks/useViewportSize'
import { fitSelection } from '../lib/canvas-arrangement'
import { type Camera, fitCamera, type Point, pointInBoard, zoomCamera } from '../lib/canvas-camera'
import { indexViewportBoards, MAX_ANIMATED_BOARDS, planViewport } from '../lib/canvas-viewport'
import type { CanvasPageEditing } from '../navigation/CanvasPageDialog'
import { CanvasPlaybackMenu } from '../navigation/CanvasPlaybackMenu'
import { PageNavigator } from '../navigation/PageNavigator'
import { CanvasArrangeMenu } from '../toolbar/CanvasArrangeMenu'
import { CanvasBoardActions, CanvasBoardQuickActions } from '../toolbar/CanvasBoardActions'
import { CanvasToolbar } from '../toolbar/CanvasControls'
import { canvasToolsMessages } from '../toolbar/canvas-tools-messages'
import type { BoardFramePurpose } from './ArtifactFrame'
import type { DrawingTool } from './BoardDrawingSurface'
import { BoardPresentation } from './BoardPresentation'
import { type CanvasBoardInput, CanvasBoardSurface } from './CanvasBoardSurface'
import { CanvasBoardTile } from './CanvasBoardTile'
import { CanvasFlowLines } from './CanvasFlowLines'
import { CanvasLayerSelectionBox } from './CanvasLayerSelectionBox'
import { CanvasArtboardPlacer, CanvasBlankDrawingOverlay } from './CanvasPlacementOverlay'
import { type InlineCanvasBox, InlineCanvasText } from './InlineCanvasText'

/** 显式选板要求适配；元素指认与图层选择只在画板不可见时移动相机。 */
export type InspectorReveal = CanvasLocation & { fit?: true }

/** 画布内当前选中图层的键盘导航与直改上下文。 */
export interface CanvasLayerSelectionContext {
  board?: CanvasBoard
  layers: readonly CanvasLayer[]
  selectedLayer?: CanvasLayer
  selectedDesignLayer?: DesignLayer
  /** 选中静态 HTML/React 元素的唯一源码位置（即使超出图层树快照上限也能直改）。 */
  sourceLoc?: string
  selectedElement: ElementRef | null
  presentation: CanvasElementPresentation | null
  visualTarget: VisualEditTarget | null
  onSelectLayer: (layer: CanvasLayer | null, shouldReveal?: boolean) => void
  onEnterBoard: (boardId: string) => void
  onApplyRuntimeOp: (op: EditOp) => Promise<boolean>
  onHtmlElementSaved?: (
    boardId: string,
    loc: string,
    nextRect: CanvasBounds,
    savedVersion: number,
  ) => void
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
  /** 仅 Hub 确认可编辑的当前画布使用；固定快照和本地预览不入房。 */
  collaborationEnabled?: boolean
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
  /** 先前提交的本地草稿可在降为只读后取回，不授予撤销或写入权限。 */
  editNotice?: ReactNode
  /** 缺省时双击不启用文字直改，原型仍只从播放入口进入。 */
  textTools?: CanvasTextTools
  /** 当前正在进行的画布文字/便签编辑草稿，总览中原地渲染在画板坐标内。 */
  inlineText?: {
    draft: CanvasTextDraft
    initialText?: string
    onInput: (text: string) => void
    onSave: (text: string) => Promise<void>
    onClose: () => void
    onAnnotate: (element: ElementRef) => void
  } | null
  /** 抽屉选板后定位；换工具不消费尚不可见的请求。 */
  reveal?: InspectorReveal | null
  onRevealHandled: () => void
  onLocationChange: (location: CanvasLocation | null) => void
  onSelectPoint?: (boardId: string, point: Point) => void
  /** 指针滑过画板时触发轻量悬停命中，用于选择与批注模式的元素高亮。 */
  onHoverPoint?: (boardId: string, point: Point) => void
  onHoverClear?: (boardId?: string) => void
  hoveredElement?: { boardId: string; element: ElementRef; label?: string } | null
  onClearElement: () => void
  /** 是否允许进入画布批注模式；仅查看权限为 false。 */
  canComment?: boolean
  /** 批注模式下点击画板或元素落点时回调（板内固有坐标 + 外壳屏幕坐标）。 */
  onCommentPoint?: (board: CanvasBoard, point: Point, anchor: Point) => void
  /** 批注模式下点击空白区域时请求关闭未输入的批注输入卡。 */
  onDismissComment?: () => void
  /** 待提交批注在画板上的临时水滴图钉位置。 */
  pendingCommentPin?: { boardId: string; point: Point } | null
  /** 画布平移缩放时向工作区同步待提交批注浮层的最新屏幕锚点。 */
  onPendingCommentAnchorChange?: (anchor: Point | null) => void
  /** 新建原生图层保存成功后自动选中。 */
  onLayerCreated?: (boardId: string, layer: DesignLayer, savedVersion: number) => void
  /** 用该画板的稳定标识打开和制品共用的导出面板。 */
  onExportBoard?: (boardId: string) => void
  exportVersion: VersionSummary
  exportSelectionRef?: Ref<() => CanvasExportSelection | undefined>
  renderBoard: (
    board: CanvasBoard,
    purpose: BoardFramePurpose,
    detailed: boolean,
    overlay?: { scale: number; hideSelectionBox: boolean },
  ) => ReactNode
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
  previewBounds?: CanvasBounds | null,
): { rect: CanvasBounds; label: string } {
  const design = layerSelection?.selectedDesignLayer
  const elemRect = layerSelection?.selectedElement?.rect
  let localRect: CanvasBounds = {
    x: 0,
    y: 0,
    width: boardBounds.width,
    height: boardBounds.height,
  }
  if (previewBounds) {
    localRect = previewBounds
  } else if (design) {
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
  if (!label && layerSelection?.selectedElement) {
    const el = layerSelection.selectedElement
    label = el.textPreview?.slice(0, 40) || el.blockId || el.selector?.slice(0, 32) || ''
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

function sameElementTarget(
  a: ElementRef | null | undefined,
  b: ElementRef | null | undefined,
): boolean {
  if (!a || !b) return false
  if (a.boardId !== b.boardId) return false
  if (a.blockId || b.blockId) return a.blockId === b.blockId && a.selector === b.selector
  if (a.selector && b.selector) return a.selector === b.selector
  return false
}

const NO_MOTION: ReadonlySet<string> = new Set()
const isPrototype = (board: CanvasBoard) => board.type === 'html' || board.type === 'react'

export function ArtifactCanvas({
  document,
  visible,
  collaborationEnabled,
  storageKey,
  address,
  onClearAddress,
  pageLink,
  pageEditing,
  boardEditing,
  historyEditing = boardEditing,
  editNotice,
  textTools,
  inlineText,
  reveal,
  onRevealHandled,
  onLocationChange,
  onSelectPoint,
  onHoverPoint,
  onHoverClear,
  hoveredElement,
  onClearElement,
  canComment = true,
  onCommentPoint,
  onDismissComment,
  pendingCommentPin,
  onPendingCommentAnchorChange,
  onLayerCreated,
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
  const [commentMode, setCommentMode] = useState(false)
  const [drawingDragging, setDrawingDragging] = useState(false)
  const commentActive = canComment && commentMode
  const presentation = useBoardPresentation(document, visible, (boardId) => {
    pendingKeyboardFocus.current = boardId
  })
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
    setCommentMode(false)
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
  const transformableHtmlElement =
    !layerSelection?.selectedDesignLayer &&
    layerSelection?.board &&
    layerSelection.board.type === 'html' &&
    !layerSelection.board.generated &&
    layerSelection.sourceLoc &&
    layerSelection.selectedElement?.rect &&
    layerSelection.selectedElement.rect.width > 0 &&
    layerSelection.selectedElement.rect.height > 0
      ? {
          loc: layerSelection.sourceLoc,
          rect: layerSelection.selectedElement.rect,
          readFullSource: layerSelection.readFullSource,
          onSaved: layerSelection.onHtmlElementSaved,
        }
      : undefined
  const transformEditing = layerSelection?.selectedDesignLayer ? boardEditing : historyEditing
  const layerGesture = useLayerGesture(transformEditing, {
    board: layerSelection?.board,
    layer: layerSelection?.selectedDesignLayer,
    htmlElement: transformableHtmlElement,
    scale: camera.scale,
  })
  const moved = boardGesture.preview?.pageId === pageId ? boardGesture.preview?.bounds : undefined
  const focused = presentation.focused
  const activePresentation = presentation.playing ?? focused
  const closePresentation = presentation.playing ? presentation.closePlay : presentation.closeFocus
  const hasSelectedElement = Boolean(
    layerSelection?.selectedElement?.rect &&
      layerSelection.selectedElement.rect.width > 0 &&
      layerSelection.selectedElement.rect.height > 0 &&
      layerSelection.board &&
      (layerSelection.selectedElement.boardId ?? STANDALONE_BOARD_ID) === layerSelection.board.id,
  )
  const hasSelectedLayer = Boolean(
    layerSelection?.selectedLayer || layerSelection?.selectedDesignLayer || hasSelectedElement,
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
      cameraInput.cancel()
      marquee.cancel()
      layerGesture.cancel()
    },
    clearSelection: () => {
      if (drawingTool || artboardPlacing || hand || commentActive) {
        setDrawingTool(null)
        setArtboardPlacing(false)
        setCommentMode(false)
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
        !commentActive &&
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
  const cameraInput = useCanvasCameraInput({
    viewportRef,
    showOverview,
    size,
    invalidAddress,
    pageId,
    handActive,
    touchEnabled: !commentActive && !drawingTool && !artboardPlacing && !visualEdit?.isPicking,
    cancelBoardGesture: () => {
      boardGesture.cancel()
      layerGesture.cancel()
    },
    moveHeldBoard: (target, pointerId, start) => {
      if (!(target instanceof HTMLButtonElement) || !boardEditing?.available) return false
      const id = target.dataset.boardContent
      if (!id) return false
      const bounds = layout.bounds.get(id)
      if (!bounds) return false
      return boardGesture.beginAt(target, pointerId, start, id, bounds, 'move')
    },
    holdContent: (target, anchor) => {
      const hit = target.closest<HTMLElement>('[data-board-content]')
      const id = hit?.dataset.boardContent
      const board = id && viewportIndex.byId.get(id)?.board
      if (!hit || !board) return false
      selectBoard(board.id)
      const point = pointInBoard(board, hit.getBoundingClientRect(), anchor)
      if (point && isPrototype(board)) textTools?.pick(board, point, anchor)
      return true
    },
    wheelLocked: Boolean(
      drawingDragging ||
        boardGesture.preview?.phase === 'dragging' ||
        layerGesture.dragging ||
        marquee.active,
    ),
    updateCamera,
  })
  const { dragging, wheelActive } = cameraInput
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
      ? resolveSelectedLayerRect(
          layerSelection,
          selectedLayerBoardBounds,
          camera,
          layerGesture.preview?.bounds,
        )
      : null
  const pendingCommentBoardBounds =
    showOverview && pendingCommentPin ? boundsFor(pendingCommentPin.boardId) : undefined
  const pendingCommentPos =
    pendingCommentPin && pendingCommentBoardBounds
      ? {
          x: camera.x + (pendingCommentBoardBounds.x + pendingCommentPin.point.x) * camera.scale,
          y: camera.y + (pendingCommentBoardBounds.y + pendingCommentPin.point.y) * camera.scale,
        }
      : null
  const pendingCommentX = pendingCommentPos?.x
  const pendingCommentY = pendingCommentPos?.y
  const lastReportedCommentAnchor = useRef<string>('')
  useLayoutEffect(() => {
    if (!onPendingCommentAnchorChange) return
    if (pendingCommentX === undefined || pendingCommentY === undefined) {
      if (lastReportedCommentAnchor.current) {
        lastReportedCommentAnchor.current = ''
        onPendingCommentAnchorChange(null)
      }
      return
    }
    const rect = viewportRef.current?.getBoundingClientRect()
    const nextAnchor = {
      x: Math.round((rect?.left ?? 0) + pendingCommentX + 22),
      y: Math.round((rect?.top ?? 0) + pendingCommentY - 24),
    }
    const sig = `${nextAnchor.x}:${nextAnchor.y}`
    if (sig === lastReportedCommentAnchor.current) return
    lastReportedCommentAnchor.current = sig
    onPendingCommentAnchorChange(nextAnchor)
  }, [onPendingCommentAnchorChange, pendingCommentX, pendingCommentY])
  const inlineTextBox = ((): InlineCanvasBox | undefined => {
    const draft = inlineText?.draft
    if (!showOverview || !draft || draft.kind === 'readOnly') return undefined
    if (draft.kind === 'create' || draft.kind === 'native') {
      const targetBoard = page?.boards.find((entry) => entry.id === draft.boardId)
      const boardBounds = boundsFor(draft.boardId)
      if (!targetBoard || !boardBounds) return undefined
      return {
        x: camera.x + (boardBounds.x + draft.layer.x) * camera.scale,
        y: camera.y + (boardBounds.y + draft.layer.y) * camera.scale,
        width: draft.layer.width * camera.scale,
        height: draft.layer.height * camera.scale,
        scale: camera.scale,
        boardBackground:
          targetBoard.appearance?.background ?? DEFAULT_ARTBOARD_APPEARANCE.background,
        viewportWidth: size.width || undefined,
      }
    }
    if (draft.kind !== 'source') return undefined
    const targetBoardId = draft.boardId ?? standalone?.id
    if (!targetBoardId) return undefined
    const targetBoard = page?.boards.find((entry) => entry.id === targetBoardId)
    const boardBounds = boundsFor(targetBoardId)
    const matchesSelection = layerSelection?.board?.id === targetBoardId
    const sourceRect =
      draft.rect ?? (matchesSelection ? layerSelection?.selectedElement?.rect : undefined)
    if (
      !targetBoard ||
      !boardBounds ||
      !sourceRect ||
      sourceRect.width <= 0 ||
      sourceRect.height <= 0
    ) {
      return undefined
    }
    return {
      x: camera.x + (boardBounds.x + sourceRect.x) * camera.scale,
      y: camera.y + (boardBounds.y + sourceRect.y) * camera.scale,
      width: sourceRect.width * camera.scale,
      height: sourceRect.height * camera.scale,
      scale: camera.scale,
      boardBackground: targetBoard.appearance?.background ?? DEFAULT_ARTBOARD_APPEARANCE.background,
      sourceStyle:
        draft.presentation ??
        (matchesSelection ? (layerSelection?.presentation ?? undefined) : undefined),
      viewportWidth: size.width || undefined,
    }
  })()
  const canDragBoards =
    boardEditing?.available &&
    !handActive &&
    !modifier &&
    !commentActive &&
    !drawingTool &&
    !artboardPlacing &&
    !visualEdit?.isPicking

  const cancelObjectInput = (event: PointerEvent<HTMLElement>) => {
    boardGesture.events.onPointerCancel(event)
    layerGesture.cancel()
    marquee.cancel()
  }

  const setCanvasTool = (next: boolean) => {
    cameraInput.cancel()
    marquee.cancel()
    layerGesture.cancel()
    setDrawingTool(null)
    setArtboardPlacing(false)
    setCommentMode(false)
    setDrawingDragging(false)
    setBlankNotice('')
    setHand(next)
    visualEdit?.cancel()
  }

  const pauseCanvasTools = () => {
    cameraInput.cancel()
    marquee.cancel()
    layerGesture.cancel()
    setDrawingTool(null)
    setArtboardPlacing(false)
    setCommentMode(false)
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
    if (commentActive) return 'comment'
    if (showOverview && board.scoped && boardEditing?.available && drawingTool) {
      return { tool: drawingTool, editing: boardEditing }
    }
    return interactive ? 'interactive' : 'select'
  }
  const activateTitle = (boardId: string, event: MouseEvent<HTMLButtonElement>) => {
    if (boardGesture.consumesClick(event) || (handActive && event.detail !== 0)) return
    if (commentActive) {
      const targetBoard = page?.boards.find((entry) => entry.id === boardId)
      if (targetBoard) {
        selectBoard(boardId)
        const rect = event.currentTarget.getBoundingClientRect()
        onCommentPoint?.(targetBoard, { x: 24, y: 24 }, { x: rect.left, y: rect.bottom + 8 })
      }
      return
    }
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
    if (event.target !== event.currentTarget) return
    if (commentActive) {
      onDismissComment?.()
      return
    }
    if (handActive || drawingTool || artboardPlacing) return
    onClearElement()
    selectBoard(null)
  }

  let activeTool = 'select'
  if (handActive) activeTool = 'hand'
  else if (commentActive) activeTool = 'comment'
  else if (artboardPlacing) activeTool = 'artboard'
  else if (drawingTool) activeTool = drawingTool.kind
  else if (visualEdit?.isPicking) activeTool = 'pick'

  const anyDragging =
    dragging || boardGesture.preview?.phase === 'dragging' || layerGesture.dragging
  const hoverAllowed =
    showOverview &&
    (activeTool === 'select' || activeTool === 'comment') &&
    !anyDragging &&
    !marquee.active &&
    !wheelActive &&
    !inlineTextBox
  useEffect(() => {
    if (!hoverAllowed) onHoverClear?.()
  }, [hoverAllowed, onHoverClear])
  const hoveredOverlay = (() => {
    if (!hoverAllowed || !hoveredElement?.element.rect) return null
    const hoveredRect = hoveredElement.element.rect
    if (hoveredRect.width <= 0 || hoveredRect.height <= 0) return null
    if (
      hasSelectedLayer &&
      layerSelection?.board?.id === hoveredElement.boardId &&
      sameElementTarget(layerSelection.selectedElement, hoveredElement.element)
    ) {
      return null
    }
    const boardBounds = boundsFor(hoveredElement.boardId)
    if (!boardBounds) return null
    return {
      rect: {
        x: camera.x + (boardBounds.x + hoveredRect.x) * camera.scale,
        y: camera.y + (boardBounds.y + hoveredRect.y) * camera.scale,
        width: Math.max(4, hoveredRect.width * camera.scale),
        height: Math.max(4, hoveredRect.height * camera.scale),
      },
      label: hoveredElement.label,
    }
  })()
  const editingSameLayer = Boolean(
    inlineTextBox &&
      ((inlineText?.draft.kind === 'native' &&
        inlineText.draft.boardId === layerSelection?.board?.id &&
        inlineText.draft.layer.id === layerSelection?.selectedDesignLayer?.id) ||
        (inlineText?.draft.kind === 'source' &&
          (inlineText.draft.boardId ?? standalone?.id) === layerSelection?.board?.id)),
  )
  const canTransformSelectedLayer = Boolean(
    activeTool === 'select' &&
      !editingSameLayer &&
      transformEditing &&
      (!transformEditing.draft || transformEditing.draft.status === 'saving') &&
      ((layerSelection?.selectedDesignLayer && !layerSelection.board?.generated) ||
        Boolean(transformableHtmlElement)),
  )

  let inlineTextKey = ''
  if (inlineText) {
    let targetId = ''
    if (inlineText.draft.kind === 'create' || inlineText.draft.kind === 'native') {
      targetId = inlineText.draft.layer.id
    } else if (inlineText.draft.kind === 'source') {
      targetId = inlineText.draft.loc
    }
    inlineTextKey = `${inlineText.draft.kind}:${inlineText.draft.base.version}:${targetId}`
  }

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
          {editNotice}
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
          data-dragging={anyDragging}
          data-marquee={marquee.box ? 'true' : undefined}
          onPointerDownCapture={cameraInput.startPointer}
          onPointerMoveCapture={cameraInput.movePointer}
          onPointerUpCapture={cameraInput.endPointer}
          onPointerCancelCapture={cameraInput.endPointer}
          onLostPointerCaptureCapture={cameraInput.endPointer}
          onPointerDown={(event) => {
            if (event.pointerType !== 'touch') marquee.onPointerDown(event)
          }}
          onPointerMove={(event) => {
            boardGesture.events.onPointerMove(event)
            marquee.onPointerMove(event)
          }}
          onPointerUp={(event) => {
            boardGesture.events.onPointerUp(event)
            marquee.onPointerUp(event)
          }}
          onPointerCancel={cancelObjectInput}
          onLostPointerCapture={cancelObjectInput}
          onClickCapture={cameraInput.blockClick}
          onDoubleClickCapture={cameraInput.blockClick}
          onContextMenuCapture={cameraInput.blockTouchMenu}
          onClick={clickBackground}
        >
          {collaborationEnabled && showOverview && !invalidAddress && page && (
            <CanvasPresence
              key={JSON.stringify([artifactId, page.id])}
              artifactId={artifactId}
              pageId={page.id}
              viewportRef={viewportRef}
              camera={camera}
            />
          )}
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
                  void boardEditing.change(
                    { kind: 'layerCreate', boardId: targetBoard.id, layer },
                    base,
                    (saved) => onLayerCreated?.(targetBoard.id, layer, saved.version),
                  )
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
                    onBeginGesture={boardGesture.begin}
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
                        !handActive &&
                          !commentActive &&
                          !drawingTool &&
                          !artboardPlacing &&
                          !visualEdit?.isPicking,
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
                              setCommentMode(false)
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
                      selectBoard={selectBoard}
                      onClearElement={onClearElement}
                      onSelectPoint={detailed ? onSelectPoint : undefined}
                      onHoverPoint={detailed ? onHoverPoint : undefined}
                      onHoverClear={onHoverClear}
                      onCommentPoint={onCommentPoint}
                      onLayerCreated={onLayerCreated}
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
                        {
                          scale: camera.scale,
                          hideSelectionBox: Boolean(
                            hasSelectedLayer && layerSelection?.board?.id === board.id,
                          ),
                        },
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
          {hoveredOverlay ? (
            <div
              data-testid="canvas-layer-hover"
              aria-hidden="true"
              className="artifact-canvas-layer-hover"
              style={{
                left: hoveredOverlay.rect.x,
                top: hoveredOverlay.rect.y,
                width: hoveredOverlay.rect.width,
                height: hoveredOverlay.rect.height,
              }}
            >
              {hoveredOverlay.label ? (
                <span
                  className="artifact-canvas-layer-hover-tag"
                  style={{ top: hoveredOverlay.rect.y < 24 ? 2 : -22 }}
                >
                  {hoveredOverlay.label}
                </span>
              ) : null}
            </div>
          ) : null}
          {showOverview &&
            hasSelectedLayer &&
            selectedLayerBoardBounds &&
            selectedLayerOverlay &&
            !editingSameLayer && (
              <>
                <CanvasLayerSelectionBox
                  focusRef={layerFocusRef}
                  rect={selectedLayerOverlay.rect}
                  previewBounds={layerGesture.preview?.bounds}
                  label={selectedLayerOverlay.label}
                  canTransform={canTransformSelectedLayer}
                  transforming={Boolean(layerGesture.preview)}
                  designLayer={layerSelection?.selectedDesignLayer}
                  onKeyDown={keyboardEditing.onLayerKeyDown}
                  onBeginGesture={layerGesture.begin}
                  gestureEvents={layerGesture.events}
                  onDoubleClickText={
                    layerSelection?.board && textTools
                      ? (event) => {
                          const targetBoard = layerSelection.board
                          if (!targetBoard) return
                          const targetLayer = layerSelection.selectedDesignLayer
                          const anchor = { x: event.clientX, y: event.clientY }
                          if (
                            targetLayer &&
                            (targetLayer.kind === 'text' || targetLayer.kind === 'note')
                          ) {
                            textTools.edit(targetBoard, targetLayer, anchor)
                            return
                          }
                          if (targetBoard.type !== 'html' && targetBoard.type !== 'react') return
                          if (
                            layerSelection.sourceLoc &&
                            layerSelection.visualTarget &&
                            layerSelection.visualTarget.text !== null
                          ) {
                            textTools.editSource(
                              targetBoard,
                              layerSelection.sourceLoc,
                              layerSelection.visualTarget.text,
                              anchor,
                              layerSelection.selectedElement?.rect,
                              layerSelection.presentation ?? undefined,
                            )
                            return
                          }
                          const viewportRect = viewportRef.current?.getBoundingClientRect()
                          if (!viewportRect || !selectedLayerBoardBounds) return
                          const boardPoint = {
                            x: Math.max(
                              0,
                              Math.min(
                                targetBoard.width,
                                (event.clientX - viewportRect.left - camera.x) / camera.scale -
                                  selectedLayerBoardBounds.x,
                              ),
                            ),
                            y: Math.max(
                              0,
                              Math.min(
                                targetBoard.height,
                                (event.clientY - viewportRect.top - camera.y) / camera.scale -
                                  selectedLayerBoardBounds.y,
                              ),
                            ),
                          }
                          textTools.pick(targetBoard, boardPoint, anchor)
                        }
                      : undefined
                  }
                  onDeepClick={
                    layerSelection?.board && onSelectPoint
                      ? (event) => {
                          const targetBoard = layerSelection.board
                          const viewportRect = viewportRef.current?.getBoundingClientRect()
                          if (!targetBoard || !viewportRect || !selectedLayerBoardBounds) return
                          const boardPoint = {
                            x: Math.max(
                              0,
                              Math.min(
                                targetBoard.width,
                                (event.clientX - viewportRect.left - camera.x) / camera.scale -
                                  selectedLayerBoardBounds.x,
                              ),
                            ),
                            y: Math.max(
                              0,
                              Math.min(
                                targetBoard.height,
                                (event.clientY - viewportRect.top - camera.y) / camera.scale -
                                  selectedLayerBoardBounds.y,
                              ),
                            ),
                          }
                          onSelectPoint(targetBoard.id, boardPoint)
                        }
                      : undefined
                  }
                />
                {!layerGesture.dragging &&
                  !commentActive &&
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
          {pendingCommentPos ? (
            <div
              data-testid="pending-comment-pin"
              aria-hidden="true"
              className="artifact-canvas-comment-pin-draft"
              style={{ left: pendingCommentPos.x, top: pendingCommentPos.y }}
            >
              <span className="inline-flex h-7 min-w-7 items-center justify-center rounded-full rounded-bl-sm border-2 border-card bg-(--canvas-selection) px-1.5 text-(--canvas-selection-foreground) shadow-md">
                <MessageSquare size={12} />
              </span>
            </div>
          ) : null}
          {inlineText && inlineTextBox ? (
            <InlineCanvasText
              key={inlineTextKey}
              draft={inlineText.draft}
              initialText={inlineText.initialText}
              canvasBox={inlineTextBox}
              onInput={inlineText.onInput}
              onClose={inlineText.onClose}
              onSave={inlineText.onSave}
              onAnnotate={inlineText.onAnnotate}
            />
          ) : null}
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
          hand={handActive}
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
          commentTool={{
            active: commentActive,
            disabled: !canComment || Boolean(invalidAddress),
            toggle: () => {
              if (commentActive) {
                setCommentMode(false)
              } else {
                setCanvasTool(false)
                setCommentMode(true)
              }
            },
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
      {visible && inlineText && !inlineTextBox ? (
        <InlineCanvasText
          draft={inlineText.draft}
          initialText={inlineText.initialText}
          onInput={inlineText.onInput}
          onClose={inlineText.onClose}
          onSave={inlineText.onSave}
          onAnnotate={inlineText.onAnnotate}
        />
      ) : null}
      {presentation.focus && focused ? (
        <BoardPresentation
          key={`focus:${JSON.stringify(presentation.focus)}`}
          board={focused}
          visible={visible && !presentation.playing}
          onClose={presentation.closeFocus}
          onPickText={
            textTools && historyEditing?.available && isPrototype(focused)
              ? (point, anchor) => textTools.pick(focused, point, anchor)
              : undefined
          }
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
