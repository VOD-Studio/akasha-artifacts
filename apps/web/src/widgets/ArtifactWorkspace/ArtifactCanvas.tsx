import { Button } from '@akasha/ui/button'
import {
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { CanvasBoard, CanvasDocument, CanvasLocation, CanvasPage } from '@/entities/artifact'
import type { BoardFramePurpose } from './ArtifactFrame'
import { BoardDrawingSurface, type DrawingTool } from './BoardDrawingSurface'
import { BoardPresentation } from './BoardPresentation'
import { CanvasArrangeMenu } from './CanvasArrangeMenu'
import {
  CanvasBoardActions,
  CanvasBoardEditNotice,
  CanvasBoardQuickActions,
} from './CanvasBoardActions'
import { CanvasToolbar } from './CanvasControls'
import type { CanvasPageEditing } from './CanvasPageDialog'
import { CanvasPlaybackMenu } from './CanvasPlaybackMenu'
import {
  changeLayoutSelection,
  fitSelection,
  groupMembers,
  type LayoutSelection,
  layoutSelectionIds,
} from './canvas-arrangement'
import {
  type Camera,
  type CanvasBounds,
  DEFAULT_CAMERA,
  fitCamera,
  layoutBoards,
  type Point,
  zoomCamera,
} from './canvas-camera'
import {
  DETAIL_SCALE,
  indexViewportBoards,
  MAX_ANIMATED_BOARDS,
  planViewport,
} from './canvas-viewport'
import { PageNavigator } from './PageNavigator'
import { useBoardGesture } from './useBoardGesture'
import { useBoardPresentation } from './useBoardPresentation'
import type { CanvasBoardEditing } from './useCanvasBoardEditing'
import type { CanvasTextTools } from './useInlineCanvasText'
import { useOverviewPlayback } from './useOverviewPlayback'
import { useViewportSize } from './useViewportSize'

/** 显式选板要求适配；元素指认与图层选择只在画板不可见时移动相机。 */
export type InspectorReveal = CanvasLocation & { fit?: true }

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
  onComment: () => void
  /** 用该画板的稳定标识打开和制品共用的导出面板。 */
  onExportBoard?: (boardId: string) => void
  renderBoard: (board: CanvasBoard, purpose: BoardFramePurpose, detailed: boolean) => ReactNode
  /** 从最新的可见范围提交优先队列，不把占位板或遗留选区当成加载需求。 */
  onDemandChange: (ids: readonly string[], idle: boolean) => void
  canPlay: (board: CanvasBoard) => boolean
  canAnimate: (board: CanvasBoard) => boolean
  /** 可视化直改的开关；省略时画布不提供直改入口。 */
  visualEdit?: { isPicking: boolean; toggle: () => void; cancel: () => void }
}

// 单个页面的视图状态：选中的画板与相机
interface PageView extends LayoutSelection {
  /** 该页面的相机；为 `null` 时用默认相机。 */
  camera: Camera | null
}

// 持久化到本地存储的画布视图
interface CanvasView {
  pageId: string | null
  address?: string
  /** 是否处于抓手平移工具。 */
  hand?: boolean
  /** 各页面的视图状态，键为页面 id。 */
  pages: Record<string, PageView>
}

const DEFAULT_PAGE: PageView = { selected: null, camera: null }
const NO_MOTION: ReadonlySet<string> = new Set()
const KEYBOARD_CONTROL =
  'input, textarea, select, button, a[href], [contenteditable]:not([contenteditable="false"]), [role="button"]'

function readView(storageKey: string): CanvasView {
  try {
    const raw = sessionStorage.getItem(storageKey)
    const saved: CanvasView | null = raw ? JSON.parse(raw) : null
    if (saved?.pages) return saved
  } catch {
    // 存储不可用时仍可在当前会话内操作画布。
  }
  return { pageId: null, pages: {} }
}

function pageViewFor(view: CanvasView, id: string): PageView {
  return Object.hasOwn(view.pages, id) ? (view.pages[id] ?? DEFAULT_PAGE) : DEFAULT_PAGE
}

function saveView(storageKey: string, view: CanvasView) {
  try {
    sessionStorage.setItem(storageKey, JSON.stringify(view))
  } catch {
    // 隐私设置或配额不影响画布本身。
  }
}

function selectedBoardFor(
  boards: readonly CanvasBoard[] | undefined,
  selected: string | null,
  selectedIds: readonly string[] | undefined,
) {
  if (selected && boards?.some((board) => board.id === selected)) return selected
  return selectedIds?.length
    ? (boards?.find((board) => selectedIds.includes(board.id))?.id ?? null)
    : null
}

function settledCamera(
  current: Camera | null,
  board: CanvasBounds | undefined,
  page: CanvasBounds,
  first: CanvasBounds | undefined,
  viewport: { width: number; height: number },
  measurable: boolean,
) {
  if (!measurable) return current
  // 新打开的重稿从第一块实稿起步；工具栏仍可一键退至整页鸟瞰。
  if (board) return fitCamera(board, viewport, 'board')
  if (current) return current
  const overview = fitCamera(page, viewport, 'page')
  return first && overview.scale < DETAIL_SCALE ? fitCamera(first, viewport, 'board') : overview
}

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
  renderBoard,
  onDemandChange,
  canPlay,
  canAnimate,
  visualEdit,
}: ArtifactCanvasProps) {
  const viewportRef = useRef<HTMLElement>(null)
  const pendingFocus = useRef<{ pageId: string; boardId: string } | null>(null)
  const pendingKeyboardFocus = useRef<string | null>(null)
  const [keyboardBoard, setKeyboardBoard] = useState<string | null>(null)
  const wheelIdle = useRef<number | undefined>(undefined)
  const [wheelActive, setWheelActive] = useState(false)
  const pointers = useRef(new Map<number, Point>())
  const wasPinching = useRef(false)
  const [view, setView] = useState(() => readView(storageKey))
  const latestView = useRef(view)
  latestView.current = view
  const [dismissedAddress, setDismissedAddress] = useState('')
  const [navigatorOpen, setNavigatorOpen] = useState(false)
  const [copyStatus, setCopyStatus] = useState('')
  const [drawingTool, setDrawingTool] = useState<DrawingTool | null>(null)
  const hand = view.hand ?? false
  const setHand = (next: boolean) =>
    setView((prev) => ((prev.hand ?? false) === next ? prev : { ...prev, hand: next }))
  const [space, setSpace] = useState(false)
  const [modifier, setModifier] = useState(false)
  const [dragging, setDragging] = useState(false)
  const presentation = useBoardPresentation(document, visible)
  const showOverview = visible && !presentation.focused && !presentation.playing
  const motion = useOverviewPlayback()
  const size = useViewportSize(viewportRef, showOverview)
  const measurable = showOverview && size.width > 0 && size.height > 0

  const params = useMemo(() => new URLSearchParams(address.replace(/^#/, '')), [address])
  const explicit = address !== dismissedAddress && (params.has('page') || params.has('board'))
  const requestedPage = params.get('page')
  const requestedBoard = params.get('board')
  const firstPage = document.pages[0]
  const overview = document.pages.find((entry) => entry.id === '') ?? firstPage
  const storedPage = document.pages.find((entry) => entry.id === view.pageId)
  const addressedPage = document.pages.find((entry) => entry.id === requestedPage)
  const addressedBoard = useMemo(
    () =>
      requestedBoard === null
        ? undefined
        : addressedPage?.boards.find((board) => board.id === requestedBoard),
    [addressedPage, requestedBoard],
  )
  const focusedShareEntry = useRef('')
  const focusShareEntry = useEffectEvent((link: string, pageId: string, boardId: string) => {
    if (focusedShareEntry.current === link) return
    focusedShareEntry.current = link
    // 定位后仍由使用者点「播放」，预览内容不会因打开链接进入交互模式。
    presentation.openFocus({ pageId, boardId }, null)
  })
  useEffect(() => {
    if (explicit && params.get('play') === '1' && addressedPage && addressedBoard) {
      focusShareEntry(address, addressedPage.id, addressedBoard.id)
    }
  }, [explicit, params, address, addressedPage, addressedBoard])
  const invalidAddress =
    explicit && (!addressedPage || (requestedBoard !== null && !addressedBoard))
  const page = explicit ? addressedPage : (storedPage ?? firstPage)
  const pageId = page?.id
  const pageView = page ? pageViewFor(view, page.id) : DEFAULT_PAGE
  const explicitSelection = invalidAddress ? undefined : pageView.selectedIds
  const selected = useMemo(
    () =>
      invalidAddress ? null : selectedBoardFor(page?.boards, pageView.selected, explicitSelection),
    [invalidAddress, page?.boards, pageView.selected, explicitSelection],
  )
  const showBoards = !invalidAddress && page && page.boards.length > 0
  const firstBoard = page?.boards[0]
  const standalone = firstBoard && !firstBoard.scoped ? firstBoard : undefined
  const activeSelection = useMemo(
    () => layoutSelectionIds(page?.boards ?? [], { selected, selectedIds: explicitSelection }),
    [page, selected, explicitSelection],
  )
  const selectedBoards = useMemo(
    () => (page?.boards ?? []).filter((board) => activeSelection.has(board.id)),
    [page, activeSelection],
  )
  const camera = pageView.camera ?? DEFAULT_CAMERA
  const layout = useMemo(
    () => layoutBoards(page?.boards ?? [], document.columns),
    [page?.boards, document.columns],
  )
  const firstBounds = firstBoard && layout.bounds.get(firstBoard.id)
  const viewportIndex = useMemo(
    () => indexViewportBoards(page?.boards ?? [], layout.bounds),
    [page?.boards, layout.bounds],
  )
  const flows = useMemo(() => {
    if (!document.showFlows) return []
    const unique = new Map<string, CanvasDocument['flows'][number]>()
    for (const flow of document.flows) {
      if (flow.from === flow.to || !layout.bounds.has(flow.from) || !layout.bounds.has(flow.to)) {
        continue
      }
      unique.set(JSON.stringify([flow.from, flow.to, flow.label]), flow)
    }
    return Array.from(unique)
  }, [document.flows, document.showFlows, layout.bounds])
  const handActive = hand || space

  const inspectedFocus = presentation.focused ? presentation.focus : null
  useEffect(() => {
    onLocationChange(
      inspectedFocus ??
        (pageId === undefined || invalidAddress
          ? null
          : { pageId, boardId: selected ?? undefined }),
    )
  }, [inspectedFocus, invalidAddress, onLocationChange, pageId, selected])

  useEffect(() => {
    setDismissedAddress((dismissed) => (dismissed === address ? dismissed : ''))
    setCopyStatus('')
  }, [address])

  useEffect(() => {
    const persist = () => saveView(storageKey, latestView.current)
    window.addEventListener('pagehide', persist)
    return () => {
      window.removeEventListener('pagehide', persist)
      persist()
    }
  }, [storageKey])
  useEffect(() => {
    const timer = window.setTimeout(() => saveView(storageKey, view), 140)
    return () => window.clearTimeout(timer)
  }, [storageKey, view])

  // 显式链接只定位一次；初次进入页面也等视口可测量后再保存相机。
  const activeAddress = explicit && !invalidAddress ? address : ''
  const addressedBoardId = activeAddress ? addressedBoard?.id : undefined
  useLayoutEffect(() => {
    if (pageId === undefined || invalidAddress) {
      if (view.address) setView((prev) => ({ ...prev, address: '' }))
      return
    }
    const pendingAddress = Boolean(activeAddress && view.address !== activeAddress)
    const focusedBoard =
      pendingFocus.current?.pageId === pageId ? pendingFocus.current.boardId : undefined
    const targetBoard = pendingAddress ? addressedBoardId : focusedBoard
    const boardBounds = targetBoard === undefined ? undefined : layout.bounds.get(targetBoard)
    const applied =
      pendingAddress && boardBounds && !measurable ? (view.address ?? '') : activeAddress
    if (measurable) pendingFocus.current = null
    if (
      !pendingAddress &&
      !boardBounds &&
      (!measurable || pageView.camera) &&
      view.address === applied
    )
      return
    setView((prev) => {
      const current = pageViewFor(prev, pageId)
      const next = {
        selected: pendingAddress ? (addressedBoardId ?? current.selected) : current.selected,
        camera: settledCamera(
          current.camera,
          boardBounds,
          layout.page,
          firstBounds,
          size,
          measurable,
        ),
      }
      if (
        prev.pageId === pageId &&
        (prev.address ?? '') === (applied ?? '') &&
        current.selected === next.selected &&
        current.camera === next.camera
      ) {
        return prev
      }
      return { ...prev, pageId, address: applied, pages: { ...prev.pages, [pageId]: next } }
    })
  }, [
    activeAddress,
    addressedBoardId,
    invalidAddress,
    firstBounds,
    layout,
    measurable,
    pageId,
    pageView.camera,
    size,
    view.address,
  ])

  const clearAddress = () => {
    if (!explicit) return
    setDismissedAddress(address)
    onClearAddress?.()
  }

  const navigate = (target: CanvasPage, boardId?: string | null) => {
    clearAddress()
    setDrawingTool(null)
    setNavigatorOpen(false)
    setCopyStatus('')
    pendingFocus.current = boardId && !measurable ? { pageId: target.id, boardId } : null
    setView((prev) => {
      const current = pageViewFor(prev, target.id)
      const bounds = boardId
        ? layoutBoards(target.boards, document.columns).bounds.get(boardId)
        : undefined
      return {
        ...prev,
        address: '',
        pageId: target.id,
        pages: {
          ...prev.pages,
          [target.id]: {
            selected: boardId === undefined ? current.selected : boardId,
            selectedIds: boardId === undefined ? current.selectedIds : undefined,
            camera: bounds && measurable ? fitCamera(bounds, size, 'board') : current.camera,
          },
        },
      }
    })
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

  const selectBoard = (boardId: string | null, additive = false) => {
    if (!page || invalidAddress) return
    if (boardId !== null || requestedBoard !== null) clearAddress()
    pendingFocus.current = null
    const id = page.id
    setView((prev) => {
      const current = pageViewFor(prev, id)
      const selection = changeLayoutSelection(page.boards, current, boardId, additive)
      const camera =
        current.camera?.fit === 'board' && (selection.selected !== current.selected || additive)
          ? { ...current.camera, fit: null }
          : current.camera
      return {
        ...prev,
        pageId: id,
        address: boardId === null && requestedBoard === null ? (prev.address ?? '') : '',
        pages: { ...prev.pages, [id]: { camera, ...selection } },
      }
    })
  }

  const updateCamera = (transform: (camera: Camera) => Camera) => {
    if (!page || invalidAddress) return
    const id = page.id
    setView((prev) => {
      const current = pageViewFor(prev, id)
      const next = transform(current.camera ?? DEFAULT_CAMERA)
      if (next === (current.camera ?? DEFAULT_CAMERA)) return prev
      return {
        ...prev,
        pageId: id,
        pages: { ...prev.pages, [id]: { ...current, camera: next } },
      }
    })
  }
  const boardGesture = useBoardGesture(boardEditing, (boardId) => {
    if (!activeSelection.has(boardId)) selectBoard(boardId)
    updateCamera((current) => (current.fit ? { ...current, fit: null } : current))
  })
  const moved = boardGesture.preview?.pageId === pageId ? boardGesture.preview?.bounds : undefined
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
  const focused = presentation.focused
  const activePresentation = presentation.playing ?? focused
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
  useEffect(() => () => window.clearTimeout(wheelIdle.current), [])
  const boundsFor = (id: string) => moved?.get(id) ?? layout.bounds.get(id)
  const canDragBoards =
    boardEditing?.available && !handActive && !modifier && !drawingTool && !visualEdit?.isPicking

  const keyDown = useEffectEvent((event: KeyboardEvent) => {
    if (event.defaultPrevented || navigatorOpen) return
    if (presentation.playing || presentation.focused) {
      if (event.key === 'Escape' && !event.isComposing) {
        event.preventDefault()
        if (presentation.playing) presentation.closePlay()
        else presentation.closeFocus()
      }
      return
    }
    const target = event.target instanceof Element ? event.target : null
    const editing = target?.closest(KEYBOARD_CONTROL)
    if (
      historyEditing &&
      (event.ctrlKey || event.metaKey) &&
      !event.altKey &&
      !event.isComposing &&
      event.key.toLowerCase() === 'z' &&
      target &&
      (target === window.document.body || viewportRef.current?.contains(target)) &&
      !target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')
    ) {
      const action = event.shiftKey ? historyEditing.redo : historyEditing.undo
      if (action) {
        boardGesture.cancel()
        event.preventDefault()
        action()
      }
      return
    }
    if (event.code === 'Space' && !editing && !event.altKey && !event.ctrlKey && !event.metaKey) {
      event.preventDefault()
      setSpace(true)
    }
    if (event.key === 'Control' || event.key === 'Meta') setModifier(true)
    if (event.key !== 'Escape' || target?.closest('input, textarea, [contenteditable="true"]'))
      return
    boardGesture.cancel()
    setDrawingTool(null)
    setHand(false)
    setSpace(false)
    onClearElement()
    visualEdit?.cancel()
    selectBoard(null)
  })

  useEffect(() => {
    if (!visible) return
    const keyUp = (event: KeyboardEvent) => {
      if (event.code === 'Space') setSpace(false)
      if (event.key === 'Control' || event.key === 'Meta')
        setModifier(event.ctrlKey || event.metaKey)
    }
    const blur = () => {
      setSpace(false)
      setModifier(false)
    }
    window.addEventListener('keydown', keyDown)
    window.addEventListener('keyup', keyUp)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('keydown', keyDown)
      window.removeEventListener('keyup', keyUp)
      window.removeEventListener('blur', blur)
    }
  }, [visible])

  const wheel = useEffectEvent((event: WheelEvent) => {
    const viewport = viewportRef.current
    if (!viewport || !(event.deltaX || event.deltaY) || pageId === undefined || invalidAddress)
      return
    event.preventDefault()
    // 绘制工具用按下时的坐标映射；退出该工具前不让滚轮改变相机。
    if (drawingTool || boardGesture.preview?.phase === 'dragging') return
    setWheelActive(true)
    window.clearTimeout(wheelIdle.current)
    wheelIdle.current = window.setTimeout(() => setWheelActive(false), 180)
    const multiplier = event.deltaMode === 1 ? 16 : 1
    const x = event.deltaX * (event.deltaMode === 2 ? size.width : multiplier)
    const y = event.deltaY * (event.deltaMode === 2 ? size.height : multiplier)
    if (event.ctrlKey || event.metaKey) {
      if (!y) return
      const rect = viewport.getBoundingClientRect()
      const anchor = { x: event.clientX - rect.left, y: event.clientY - rect.top }
      updateCamera((current) => zoomCamera(current, Math.exp(-y * 0.002), anchor))
      return
    }
    const horizontal = event.shiftKey && !x
    updateCamera((current) => ({
      ...current,
      x: current.x - (horizontal ? y : x),
      y: current.y - (horizontal ? 0 : y),
      fit: null,
    }))
  })

  useEffect(() => {
    const viewport = viewportRef.current
    if (!showOverview || !viewport) return
    viewport.addEventListener('wheel', wheel, { passive: false })
    return () => viewport.removeEventListener('wheel', wheel)
  }, [showOverview])

  const startPointer = (event: PointerEvent<HTMLElement>) => {
    // Portal 内容沿 React 树冒泡，但不属于画布的 DOM 手势区域。
    const target = event.target as Element
    if (event.button !== 0 || !event.currentTarget.contains(target)) return
    if (!pointers.current.size) wasPinching.current = false
    if (target.closest('.artifact-canvas-board-action')) return
    if (
      !handActive &&
      (event.pointerType !== 'touch' || target.closest('.artifact-canvas-board-header'))
    ) {
      return
    }
    if (invalidAddress || pointers.current.size >= 2) return
    const local = event.currentTarget.getBoundingClientRect()
    pointers.current.set(event.pointerId, {
      x: event.clientX - local.left,
      y: event.clientY - local.top,
    })
    if (pointers.current.size === 2) wasPinching.current = true
    const capture = handActive ? event.currentTarget : target
    capture.setPointerCapture?.(event.pointerId)
    if (handActive) {
      event.currentTarget.focus({ preventScroll: true })
      event.preventDefault()
      setDragging(true)
    }
  }

  const movePointer = (event: PointerEvent<HTMLElement>) => {
    const previous = pointers.current.get(event.pointerId)
    if (!previous) return
    const local = event.currentTarget.getBoundingClientRect()
    const next = { x: event.clientX - local.left, y: event.clientY - local.top }
    pointers.current.set(event.pointerId, next)
    let other: Point | undefined
    if (pointers.current.size === 2) {
      for (const [id, point] of pointers.current) {
        if (id !== event.pointerId) {
          other = point
          break
        }
      }
    }
    if (other) {
      const distance = Math.hypot(previous.x - other.x, previous.y - other.y)
      if (!distance) return
      const anchor = { x: (previous.x + other.x) / 2, y: (previous.y + other.y) / 2 }
      const center = { x: (next.x + other.x) / 2, y: (next.y + other.y) / 2 }
      const factor = Math.hypot(next.x - other.x, next.y - other.y) / distance
      updateCamera((current) => zoomCamera(current, factor, anchor, center))
    } else if (handActive) {
      updateCamera((current) => ({
        ...current,
        x: current.x + next.x - previous.x,
        y: current.y + next.y - previous.y,
        fit: null,
      }))
    }
  }

  const endPointer = (event: PointerEvent<HTMLElement>) => {
    pointers.current.delete(event.pointerId)
    if (!pointers.current.size) setDragging(false)
  }

  const setCanvasTool = (next: boolean) => {
    boardGesture.cancel()
    setDrawingTool(null)
    setHand(next)
    visualEdit?.cancel()
  }

  const pauseCanvasTools = () => {
    boardGesture.cancel()
    setDrawingTool(null)
    setNavigatorOpen(false)
    setSpace(false)
    setModifier(false)
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
  const activateTitle = (boardId: string, event: MouseEvent<HTMLButtonElement>) => {
    if (boardGesture.consumesClick(event) || (handActive && event.detail !== 0)) return
    onClearElement()
    selectBoard(boardId, event.shiftKey)
  }
  const activateContent = (
    board: CanvasBoard,
    event: MouseEvent<HTMLButtonElement>,
    detailed: boolean,
  ) => {
    if (wasPinching.current && event.detail !== 0) return
    if (event.detail === 2) return
    onClearElement()
    selectBoard(board.id, event.shiftKey)
    if (event.detail !== 1 || event.shiftKey || !detailed || !onSelectPoint) return
    const point = pointInBoard(board, event)
    if (point) onSelectPoint(board.id, point)
  }
  const editText = (board: CanvasBoard, event: MouseEvent<HTMLButtonElement>) => {
    if (!textTools || wasPinching.current || !isPrototype(board)) return
    const point = pointInBoard(board, event)
    if (!point) return
    event.preventDefault()
    selectBoard(board.id)
    textTools.pick(board, point, { x: event.clientX, y: event.clientY })
  }
  const clickBackground = (event: MouseEvent<HTMLElement>) => {
    if (event.target !== event.currentTarget || handActive || wasPinching.current || drawingTool)
      return
    onClearElement()
    selectBoard(null)
  }

  return (
    <>
      <div hidden={!showOverview} className={showOverview ? 'artifact-canvas-shell' : 'hidden'}>
        <div className="artifact-canvas-navigation">
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
          {historyEditing ? <CanvasBoardEditNotice editing={historyEditing} /> : null}
        </div>
        {/* biome-ignore lint/a11y/useKeyWithClickEvents: 键盘用 Escape 清空同一选区；点击这里只处理空白。 */}
        <section
          ref={viewportRef}
          aria-label="画布"
          tabIndex={-1}
          className="artifact-canvas"
          data-hand={handActive}
          data-dragging={dragging}
          onPointerDown={startPointer}
          onPointerMove={movePointer}
          onPointerUp={endPointer}
          onPointerCancel={endPointer}
          onLostPointerCapture={endPointer}
          onClick={clickBackground}
        >
          {invalidAddress && (
            <div className="artifact-canvas-message">
              <p role="alert">{addressedPage ? '链接中的画板不存在' : '链接中的页面不存在'}</p>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  const target = addressedPage ?? overview
                  if (target) navigate(target, null)
                  else clearAddress()
                }}
              >
                {addressedPage ? '返回页面' : '返回总览'}
              </Button>
            </div>
          )}
          {showBoards && (
            <>
              {flows.length ? (
                <svg
                  aria-hidden="true"
                  className="artifact-canvas-flows"
                  data-hand-drawn={document.handDrawnFlows}
                >
                  {flows.map(([key, { from, to, label }]) => {
                    const start = boundsFor(from)
                    const end = boundsFor(to)
                    if (!start || !end) return null
                    const sameRow = start.y === end.y
                    const forward = sameRow ? start.x < end.x : start.y < end.y
                    const x1 =
                      camera.x +
                      (start.x + start.width * (sameRow ? Number(forward) : 0.5)) * camera.scale
                    const x2 =
                      camera.x +
                      (end.x + end.width * (sameRow ? Number(!forward) : 0.5)) * camera.scale
                    const y1 =
                      camera.y +
                      (start.y + start.height * (sameRow ? 0.5 : Number(forward))) * camera.scale
                    const y2 =
                      camera.y +
                      (end.y + end.height * (sameRow ? 0.5 : Number(!forward))) * camera.scale
                    return (
                      <g key={key}>
                        <line x1={x1} y1={y1} x2={x2} y2={y2} />
                        {label ? (
                          <text x={(x1 + x2) / 2} y={(y1 + y2) / 2 - 6}>
                            {label}
                          </text>
                        ) : null}
                      </g>
                    )
                  })}
                </svg>
              ) : null}
              {(standalone ? [standalone] : plan.boards).map((board) => {
                const bounds = boundsFor(board.id)
                if (!bounds) return null
                const isSelected = activeSelection.has(board.id)
                const detailed =
                  (showOverview && plan.runtime.has(board.id)) ||
                  (board === standalone && !activePresentation)
                const interactive =
                  !handActive &&
                  detailed &&
                  board === standalone &&
                  (!isPrototype(board) || Boolean(visualEdit?.isPicking))
                const target = { pageId: page.id, boardId: board.id }
                const captureGesture = handActive || modifier
                const drawing =
                  !captureGesture && showOverview && board.scoped && boardEditing?.available
                    ? drawingTool
                    : null
                return (
                  <div
                    key={board.id}
                    className="artifact-canvas-board"
                    data-selected={isSelected}
                    style={{
                      left: camera.x + bounds.x * camera.scale,
                      top: camera.y + bounds.y * camera.scale,
                      width: bounds.width * camera.scale,
                      height: bounds.height * camera.scale,
                    }}
                  >
                    <div className="artifact-canvas-board-header">
                      {/* 标题、命中区与尺寸柄的指针边界由画布布局决定。 */}
                      <button
                        type="button"
                        className="artifact-canvas-board-title"
                        aria-pressed={isSelected}
                        data-board-id={board.id}
                        title={board.subtitle ?? board.title}
                        data-movable={canDragBoards ? true : undefined}
                        {...boardGesture.events}
                        onPointerDown={(event) => {
                          if (!canDragBoards || event.shiftKey) return
                          const ids = isSelected
                            ? activeSelection
                            : groupMembers(page.boards, board.id)
                          const initial = new Map([[board.id, bounds]])
                          for (const id of ids) {
                            const included = layout.bounds.get(id)
                            if (included) initial.set(id, included)
                          }
                          boardGesture.begin(event, {
                            pageId: page.id,
                            boardId: board.id,
                            initial,
                            mode: 'move',
                            scale: camera.scale,
                          })
                        }}
                        onFocus={(event) => {
                          setKeyboardBoard(board.id)
                          if (!measurable || !event.currentTarget.matches(':focus-visible')) return
                          const viewport = viewportRef.current?.getBoundingClientRect()
                          const title = event.currentTarget.getBoundingClientRect()
                          if (
                            viewport &&
                            (title.right < viewport.left ||
                              title.left > viewport.right ||
                              title.bottom < viewport.top ||
                              title.top > viewport.bottom)
                          ) {
                            updateCamera(() => fitCamera(bounds, size, null))
                          }
                        }}
                        onKeyDown={(event) => {
                          const { key } = event
                          if (
                            ![
                              'ArrowLeft',
                              'ArrowRight',
                              'ArrowUp',
                              'ArrowDown',
                              'Home',
                              'End',
                            ].includes(key)
                          )
                            return
                          event.preventDefault()
                          const index = page.boards.indexOf(board)
                          const offset = key === 'ArrowLeft' || key === 'ArrowUp' ? -1 : 1
                          let next: CanvasBoard | undefined = page.boards[index + offset]
                          if (key === 'Home') next = page.boards[0]
                          if (key === 'End') next = page.boards.at(-1)
                          if (next && next.id !== board.id) {
                            pendingKeyboardFocus.current = next.id
                            onClearElement()
                            navigate(page, next.id)
                          }
                        }}
                        onClick={(event) => activateTitle(board.id, event)}
                      >
                        {board.title}
                        {board.recommended ? (
                          <span className="ml-2 text-[10px] opacity-75">推荐</span>
                        ) : null}
                      </button>
                      <CanvasBoardQuickActions
                        title={board.title}
                        onExpand={(event) => {
                          pauseCanvasTools()
                          presentation.openFocus(target, event.currentTarget)
                        }}
                        onPlay={
                          isPrototype(board) && canPlay(board)
                            ? (event) => {
                                pauseCanvasTools()
                                presentation.openPlay(target, event.currentTarget)
                              }
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
                    </div>
                    <div
                      className="artifact-canvas-board-clip"
                      style={
                        board.cornerRadius
                          ? { borderRadius: board.cornerRadius * camera.scale }
                          : undefined
                      }
                    >
                      <div
                        style={{
                          width: board.width,
                          height: board.height,
                          transform: `scale(${camera.scale})`,
                        }}
                        className="artifact-canvas-board-frame"
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
                      </div>
                      {/* 抓手与组合键缩放由外层捕获，不依赖跨域 iframe 冒泡。 */}
                      {captureGesture && (
                        <div
                          aria-hidden="true"
                          data-gesture
                          className="artifact-canvas-board-hit"
                        />
                      )}
                      {drawing && boardEditing && (
                        <BoardDrawingSurface
                          key={drawing.kind}
                          board={board}
                          tool={drawing}
                          version={boardEditing.version}
                          onCreate={(layer, base, anchor) => {
                            selectBoard(board.id)
                            setDrawingTool(null)
                            if (layer.kind === 'text' || layer.kind === 'note') {
                              textTools?.place(board, layer, base, anchor)
                            } else {
                              boardEditing.change(
                                { kind: 'layerCreate', boardId: board.id, layer },
                                base,
                              )
                            }
                          }}
                        />
                      )}
                      {!captureGesture && !drawing && !interactive && (
                        <button
                          type="button"
                          tabIndex={-1}
                          aria-label={`选择画板：${board.title}`}
                          className="artifact-canvas-board-hit"
                          onClick={(event) => activateContent(board, event, detailed)}
                          onDoubleClick={(event) => editText(board, event)}
                        />
                      )}
                    </div>
                    {selected === board.id && canDragBoards ? (
                      <button
                        type="button"
                        className="artifact-canvas-board-resize"
                        tabIndex={-1}
                        aria-label={`拖动调整尺寸：${board.title}`}
                        title="拖动调整尺寸；键盘请使用设置画板"
                        {...boardGesture.events}
                        onPointerDown={(event) =>
                          boardGesture.begin(event, {
                            pageId: page.id,
                            boardId: board.id,
                            initial: new Map([[board.id, bounds]]),
                            mode: 'resize',
                            scale: camera.scale,
                          })
                        }
                      />
                    ) : null}
                  </div>
                )
              })}
            </>
          )}
          {!invalidAddress && !showBoards && (
            <p className="artifact-canvas-message text-sm text-ink-muted">此页面没有画板</p>
          )}
        </section>
        <CanvasToolbar
          camera={camera}
          playbackMenu={
            !invalidAddress && page && page.boards.length > 0 ? (
              <CanvasPlaybackMenu
                boards={page.boards}
                canPlay={canPlay}
                canAnimate={canAnimate}
                paused={motion.paused}
                onTogglePause={motion.togglePause}
                onOpen={(id, trigger) => openFromMenu(id, trigger, false)}
                onPlay={(id, trigger) => openFromMenu(id, trigger, true)}
              />
            ) : undefined
          }
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
          onAddBoard={
            boardEditing && page && !invalidAddress
              ? () => {
                  boardEditing.change({
                    kind: 'create',
                    id: crypto.randomUUID(),
                    title: `画板 ${page.boards.length + 1}`,
                    pageId: page.id,
                  })
                }
              : undefined
          }
          canAddBoard={boardEditing?.available}
          onComment={onComment}
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
          onToggleVisualEdit={() => {
            setHand(false)
            setDrawingTool(null)
            visualEdit?.toggle()
          }}
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

function pointInBoard(board: CanvasBoard, event: MouseEvent<HTMLButtonElement>): Point | null {
  const rect = event.currentTarget.getBoundingClientRect()
  if (!rect.width || !rect.height) return null
  return {
    x: Math.max(0, ((event.clientX - rect.left) * board.width) / rect.width),
    y: Math.max(0, ((event.clientY - rect.top) * board.height) / rect.height),
  }
}
