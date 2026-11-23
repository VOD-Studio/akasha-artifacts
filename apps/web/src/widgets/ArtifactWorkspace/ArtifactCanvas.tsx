import { Button } from '@akasha/ui/button'
import { Focus, Play } from 'lucide-react'
import {
  type PointerEvent,
  type ReactNode,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useSelectionStore } from '../../entities/selection/store'
import type { BoardFramePurpose } from './ArtifactFrame'
import { BoardPresentation } from './BoardPresentation'
import { CanvasToolbar, PageNavigator } from './CanvasControls'
import type { CanvasPageEditing } from './CanvasPageActions'
import {
  type Camera,
  DEFAULT_CAMERA,
  fitCamera,
  layoutBoards,
  type Point,
  zoomCamera,
} from './canvas-camera'
import type { CanvasBoard, CanvasDocument, CanvasLocation, CanvasPage } from './canvas-model'
import { useBoardPresentation } from './useBoardPresentation'
import { useViewportSize } from './useViewportSize'

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
  /** 抽屉选板后定位；换工具不消费尚不可见的请求。 */
  reveal?: CanvasLocation | null
  onLocationChange: (location: CanvasLocation | null) => void
  renderBoard: (board: CanvasBoard, purpose: BoardFramePurpose) => ReactNode
  canPlay: (board: CanvasBoard) => boolean
  /** 可视化直改的开关；省略时画布不提供直改入口。 */
  visualEdit?: { isPicking: boolean; toggle: () => void; cancel: () => void }
}

// 单个页面的视图状态：选中的画板与相机
interface PageView {
  /** 当前选中的画板 id；没有选中时为 `null`。 */
  selected: string | null
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

const isPrototype = (board: CanvasBoard) => board.type === 'html' || board.type === 'react'

export function ArtifactCanvas({
  document,
  visible,
  storageKey,
  address,
  onClearAddress,
  pageLink,
  pageEditing,
  reveal,
  onLocationChange,
  renderBoard,
  canPlay,
  visualEdit,
}: ArtifactCanvasProps) {
  const viewportRef = useRef<HTMLElement>(null)
  const pendingFocus = useRef<{ pageId: string; boardId: string } | null>(null)
  const handledReveal = useRef<CanvasLocation | null>(null)
  const pointers = useRef(new Map<number, Point>())
  const wasPinching = useRef(false)
  const [view, setView] = useState(() => readView(storageKey))
  const latestView = useRef(view)
  latestView.current = view
  const [dismissedAddress, setDismissedAddress] = useState('')
  const [navigatorOpen, setNavigatorOpen] = useState(false)
  const [copyStatus, setCopyStatus] = useState('')
  const hand = view.hand ?? false
  const setHand = (next: boolean) =>
    setView((prev) => ((prev.hand ?? false) === next ? prev : { ...prev, hand: next }))
  const [space, setSpace] = useState(false)
  const [modifier, setModifier] = useState(false)
  const [dragging, setDragging] = useState(false)
  const pickerActive = useSelectionStore((state) => state.pickerActive)
  const setPickerActive = useSelectionStore((state) => state.setPickerActive)
  const presentation = useBoardPresentation(document, visible)
  const showOverview = visible && !presentation.focused && !presentation.playing
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
  const addressedBoard = addressedPage?.boards.find((board) => board.id === requestedBoard)
  const invalidAddress =
    explicit && (!addressedPage || (requestedBoard !== null && !addressedBoard))
  const page = explicit ? addressedPage : (storedPage ?? firstPage)
  const pageId = page?.id
  const pageView = page ? pageViewFor(view, page.id) : DEFAULT_PAGE
  const selected =
    !invalidAddress && page?.boards.some((board) => board.id === pageView.selected)
      ? pageView.selected
      : null
  const camera = pageView.camera ?? DEFAULT_CAMERA
  const layout = useMemo(
    () => layoutBoards(page?.boards ?? [], document.columns),
    [page?.boards, document.columns],
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
        camera: measurable
          ? boardBounds
            ? fitCamera(boardBounds, size, 'board')
            : (current.camera ?? fitCamera(layout.page, size, 'page'))
          : current.camera,
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
            camera: bounds && measurable ? fitCamera(bounds, size, 'board') : current.camera,
          },
        },
      }
    })
  }

  const revealFromInspector = useEffectEvent((target: CanvasLocation) => {
    const page = document.pages.find((item) => item.id === target.pageId)
    if (!page || (target.boardId && !page.boards.some((item) => item.id === target.boardId))) return
    presentation.dismiss()
    navigate(page, target.boardId)
  })
  useEffect(() => {
    if (!visible || !reveal || handledReveal.current === reveal) return
    handledReveal.current = reveal
    revealFromInspector(reveal)
  }, [reveal, visible])

  const selectBoard = (boardId: string | null) => {
    if (!page || invalidAddress) return
    if (boardId !== null || requestedBoard !== null) clearAddress()
    pendingFocus.current = null
    const id = page.id
    setView((prev) => {
      const current = pageViewFor(prev, id)
      const camera =
        current.camera?.fit === 'board' && boardId !== current.selected
          ? { ...current.camera, fit: null }
          : current.camera
      return {
        ...prev,
        pageId: id,
        address: boardId === null && requestedBoard === null ? (prev.address ?? '') : '',
        pages: { ...prev.pages, [id]: { camera, selected: boardId } },
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
    if (event.code === 'Space' && !editing && !event.altKey && !event.ctrlKey && !event.metaKey) {
      event.preventDefault()
      setSpace(true)
    }
    if (event.key === 'Control' || event.key === 'Meta') setModifier(true)
    if (event.key !== 'Escape' || target?.closest('input, textarea, [contenteditable="true"]'))
      return
    setHand(false)
    setSpace(false)
    setPickerActive(false)
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
    if (!viewport || !event.deltaY || pageId === undefined || invalidAddress) return
    event.preventDefault()
    const rect = viewport.getBoundingClientRect()
    const anchor = { x: event.clientX - rect.left, y: event.clientY - rect.top }
    const delta =
      event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? size.height : 1)
    updateCamera((current) => zoomCamera(current, Math.exp(-delta * 0.002), anchor))
  })

  useEffect(() => {
    const viewport = viewportRef.current
    if (!showOverview || !viewport) return
    viewport.addEventListener('wheel', wheel, { passive: false })
    return () => viewport.removeEventListener('wheel', wheel)
  }, [showOverview])

  const startPointer = (event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return
    if (!pointers.current.size) wasPinching.current = false
    const target = event.target as Element
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
    setHand(next)
    setPickerActive(false)
    visualEdit?.cancel()
  }

  const pauseCanvasTools = () => {
    setNavigatorOpen(false)
    setPickerActive(false)
    setSpace(false)
    setModifier(false)
    visualEdit?.cancel()
  }

  const selectionBounds = selected === null ? undefined : layout.bounds.get(selected)
  const zoom = (factor: number) =>
    updateCamera((current) =>
      zoomCamera(current, factor, { x: size.width / 2, y: size.height / 2 }),
    )

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
            onNavigate={navigate}
            pageLink={pageLink}
            pageEditing={pageEditing}
            status={copyStatus}
            onStatus={setCopyStatus}
          />
        </div>
        <section
          ref={viewportRef}
          aria-label="制品画布"
          tabIndex={-1}
          className="artifact-canvas"
          data-hand={handActive}
          data-dragging={dragging}
          onPointerDown={startPointer}
          onPointerMove={movePointer}
          onPointerUp={endPointer}
          onPointerCancel={endPointer}
          onLostPointerCapture={endPointer}
        >
          {invalidAddress ? (
            <div className="artifact-canvas-message">
              <p role="alert">
                {addressedPage ? '链接指定的画板不存在或已移除' : '链接指定的页面不存在或已移除'}
              </p>
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
          ) : page?.boards.length ? (
            <>
              {flows.length ? (
                <svg
                  aria-hidden="true"
                  className="artifact-canvas-flows"
                  data-hand-drawn={document.handDrawnFlows}
                >
                  {flows.map(([key, { from, to, label }]) => {
                    const start = layout.bounds.get(from)
                    const end = layout.bounds.get(to)
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
              {page.boards.map((board) => {
                const bounds = layout.bounds.get(board.id)
                if (!bounds) return null
                const isSelected = selected === board.id
                const interactive =
                  !handActive &&
                  (!isPrototype(board) ||
                    pickerActive ||
                    (!board.scoped && Boolean(visualEdit?.isPicking)))
                const target = { pageId: page.id, boardId: board.id }
                return (
                  <div
                    key={board.id}
                    className="artifact-canvas-board"
                    data-selected={isSelected}
                    style={{
                      left: camera.x + bounds.x * camera.scale,
                      top: camera.y + bounds.y * camera.scale,
                      width: board.width * camera.scale,
                      height: board.height * camera.scale,
                    }}
                  >
                    <div className="artifact-canvas-board-header">
                      <button
                        type="button"
                        className="artifact-canvas-board-title"
                        aria-pressed={isSelected}
                        title={board.subtitle ?? board.title}
                        onFocus={(event) => {
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
                        onClick={(event) => {
                          if (!handActive || event.detail === 0) selectBoard(board.id)
                        }}
                      >
                        {board.title}
                        {board.recommended ? (
                          <span className="ml-2 text-[10px] opacity-75">推荐</span>
                        ) : null}
                      </button>
                      <Button
                        size="sm"
                        variant="secondary"
                        iconOnly
                        className="artifact-canvas-board-action"
                        aria-label={`聚焦画板：${board.title}`}
                        title="聚焦画板"
                        onClick={(event) => {
                          pauseCanvasTools()
                          presentation.openFocus(target, event.currentTarget)
                        }}
                      >
                        <Focus size={15} />
                      </Button>
                      {isPrototype(board) && canPlay(board) ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          iconOnly
                          className="artifact-canvas-board-action"
                          aria-label={`播放画板：${board.title}`}
                          title="播放原型"
                          onClick={(event) => {
                            pauseCanvasTools()
                            presentation.openPlay(target, event.currentTarget)
                          }}
                        >
                          <Play size={15} />
                        </Button>
                      ) : null}
                    </div>
                    <div className="artifact-canvas-board-clip">
                      <div
                        style={{
                          width: board.width,
                          height: board.height,
                          transform: `scale(${camera.scale})`,
                        }}
                        className="artifact-canvas-board-frame"
                      >
                        {renderBoard(board, { type: 'overview', interactive })}
                      </div>
                      {/* 抓手与组合键缩放由外层捕获，不依赖跨域 iframe 冒泡。 */}
                      {handActive || modifier ? (
                        <div
                          aria-hidden="true"
                          data-gesture
                          className="artifact-canvas-board-hit"
                        />
                      ) : !interactive ? (
                        <button
                          type="button"
                          tabIndex={-1}
                          aria-label={`选择画板：${board.title}`}
                          className="artifact-canvas-board-hit"
                          onClick={(event) => {
                            if (!wasPinching.current || event.detail === 0) selectBoard(board.id)
                          }}
                        />
                      ) : null}
                    </div>
                  </div>
                )
              })}
            </>
          ) : (
            <p className="artifact-canvas-message text-sm text-ink-muted">此页面没有画板</p>
          )}
        </section>
        <CanvasToolbar
          camera={camera}
          hand={hand}
          onChangeTool={setCanvasTool}
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
          onStartPicker={() => {
            setHand(false)
            visualEdit?.cancel()
          }}
          visualEditActive={visualEdit?.isPicking}
          onToggleVisualEdit={() => {
            setHand(false)
            setPickerActive(false)
            visualEdit?.toggle()
          }}
        />
      </div>
      {presentation.focus && presentation.focused ? (
        <BoardPresentation
          key={`focus:${JSON.stringify(presentation.focus)}`}
          board={presentation.focused}
          visible={visible && !presentation.playing}
          onClose={presentation.closeFocus}
          onPlay={
            isPrototype(presentation.focused) && canPlay(presentation.focused)
              ? (event) => {
                  if (presentation.focus)
                    presentation.openPlay(presentation.focus, event.currentTarget)
                }
              : undefined
          }
        >
          {renderBoard(presentation.focused, { type: 'focus' })}
        </BoardPresentation>
      ) : null}
      {visible && presentation.play && presentation.playing ? (
        <BoardPresentation
          key={`play:${JSON.stringify(presentation.play)}`}
          board={presentation.playing}
          playback
          onClose={presentation.closePlay}
        >
          {renderBoard(presentation.playing, {
            type: 'play',
            onNavigate: presentation.navigate,
            onExit: presentation.closePlay,
          })}
        </BoardPresentation>
      ) : null}
    </>
  )
}
