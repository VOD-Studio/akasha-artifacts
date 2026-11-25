import { useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  type CanvasBoard,
  type CanvasBounds,
  type CanvasDocument,
  type CanvasPage,
  layoutBoards,
} from '@/entities/artifact'
import {
  changeLayoutSelection,
  type LayoutSelection,
  layoutSelectionIds,
} from '../lib/canvas-arrangement'
import { type Camera, DEFAULT_CAMERA, fitCamera } from '../lib/canvas-camera'
import { DETAIL_SCALE } from '../lib/canvas-viewport'

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

interface CanvasViewOptions {
  document: CanvasDocument
  storageKey: string
  address: string
  onClearAddress?: () => void
  onAddressChange: () => void
  onShareFocus: (pageId: string, boardId: string) => void
  size: { width: number; height: number }
  measurable: boolean
}

/** 每页独立保留相机与选区；显式链接只在可测量后完成定位，不随热更新重复适配。 */
export function useCanvasView({
  document,
  storageKey,
  address,
  onClearAddress,
  onAddressChange,
  onShareFocus,
  size,
  measurable,
}: CanvasViewOptions) {
  const pendingFocus = useRef<{ pageId: string; boardId: string } | null>(null)
  const [view, setView] = useState(() => readView(storageKey))
  const latestView = useRef(view)
  latestView.current = view
  const [dismissedAddress, setDismissedAddress] = useState('')
  const hand = view.hand ?? false
  const setHand = (next: boolean) =>
    setView((prev) => ((prev.hand ?? false) === next ? prev : { ...prev, hand: next }))
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
    onShareFocus(pageId, boardId)
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
  const activeSelection = useMemo(
    () => layoutSelectionIds(page?.boards ?? [], { selected, selectedIds: explicitSelection }),
    [page, selected, explicitSelection],
  )
  const firstBoard = page?.boards[0]
  const camera = pageView.camera ?? DEFAULT_CAMERA
  const layout = useMemo(
    () => layoutBoards(page?.boards ?? [], document.columns),
    [page?.boards, document.columns],
  )
  const firstBounds = firstBoard && layout.bounds.get(firstBoard.id)

  const addressChanged = useEffectEvent(onAddressChange)
  useEffect(() => {
    setDismissedAddress((dismissed) => (dismissed === address ? dismissed : ''))
    addressChanged()
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

  return {
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
    updateCamera,
    clearAddress,
    navigate,
  }
}
