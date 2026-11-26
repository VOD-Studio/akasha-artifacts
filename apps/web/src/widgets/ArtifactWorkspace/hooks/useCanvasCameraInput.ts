import {
  type MouseEvent,
  type PointerEvent,
  type RefObject,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from 'react'
import { type Camera, type Point, zoomCamera } from '../lib/canvas-camera'

const HOLD_MS = 500
const TOUCH_SLOP = 8

interface CameraInputOptions {
  viewportRef: RefObject<HTMLElement | null>
  showOverview: boolean
  size: { width: number; height: number }
  invalidAddress: boolean
  pageId?: string
  handActive: boolean
  wheelLocked: boolean
  touchEnabled: boolean
  cancelBoardGesture: () => void
  moveHeldBoard: (target: Element, pointerId: number, start: Point) => boolean
  holdContent: (target: Element, point: Point) => boolean
  updateCamera: (transform: (camera: Camera) => Camera) => void
}

/** 抓手、双指和滚轮统一更新视口相机；捏合后的合成点击不能当作选板。 */
export function useCanvasCameraInput({
  viewportRef,
  showOverview,
  size,
  invalidAddress,
  pageId,
  handActive,
  touchEnabled,
  cancelBoardGesture,
  holdContent,
  moveHeldBoard,
  wheelLocked,
  updateCamera,
}: CameraInputOptions) {
  const wheelIdle = useRef<number | undefined>(undefined)
  const [wheelActive, setWheelActive] = useState(false)
  const pointers = useRef(new Map<number, Point>())
  const pointerType = useRef('')
  const single = useRef<{
    target: Element
    start: Point
    time: number
    pan: boolean
    moveHeldBoard: CameraInputOptions['moveHeldBoard']
    moved: boolean
  } | null>(null)
  const suppressClick = useRef(false)
  const [dragging, setDragging] = useState(false)
  useEffect(() => () => window.clearTimeout(wheelIdle.current), [])
  const cancel = () => {
    cancelBoardGesture()
    if (!pointers.current.size) return
    const viewport = viewportRef.current
    for (const id of pointers.current.keys()) {
      if (viewport?.hasPointerCapture?.(id)) viewport.releasePointerCapture(id)
    }
    pointers.current.clear()
    single.current = null
    suppressClick.current = true
    setDragging(false)
  }
  const cancelPointers = useEffectEvent(cancel)
  useEffect(() => {
    if (!showOverview || pageId === undefined || (!touchEnabled && !handActive)) return
    // 虚拟画板被移除时，浏览器把 lostpointercapture 发给 document 而非原来的命中区。
    const removed = (event: globalThis.PointerEvent) => {
      if (event.target === document && pointers.current.has(event.pointerId)) cancelPointers()
    }
    document.addEventListener('lostpointercapture', removed)
    window.addEventListener('blur', cancelPointers)
    return () => {
      document.removeEventListener('lostpointercapture', removed)
      window.removeEventListener('blur', cancelPointers)
      cancelPointers()
    }
  }, [handActive, pageId, showOverview, touchEnabled])
  const wheel = useEffectEvent((event: WheelEvent) => {
    const viewport = viewportRef.current
    if (!viewport || !(event.deltaX || event.deltaY) || pageId === undefined || invalidAddress)
      return
    event.preventDefault()
    // 绘制工具用按下时的坐标映射；退出该工具前不让滚轮改变相机。
    if (wheelLocked) return
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
  }, [showOverview, viewportRef])

  const startPointer = (event: PointerEvent<HTMLElement>) => {
    const target = event.target
    const viewport = event.currentTarget
    // Portal 内容沿 React 树传播，但不属于画布的 DOM 手势区域。
    if (!(target instanceof Element) || !viewport.contains(target) || event.button !== 0) return
    const points = pointers.current
    if (!points.size && event.isPrimary !== false) suppressClick.current = false
    const touch = event.pointerType === 'touch'
    if (invalidAddress || !showOverview || (!handActive && !(touch && touchEnabled))) return
    if (!points.size) {
      if (touch && event.isPrimary === false) return
      const control = target.closest('button, input, textarea, select, a, [role="toolbar"]')
      if (
        control &&
        !control.matches(
          '.artifact-canvas-board-title, .artifact-canvas-board-hit, .artifact-canvas-board-resize',
        )
      )
        return
      pointerType.current = event.pointerType
    } else if (!touch || pointerType.current !== 'touch') return
    const rect = viewport.getBoundingClientRect()
    const start = { x: event.clientX - rect.left, y: event.clientY - rect.top }
    points.set(event.pointerId, start)
    if (points.size > 1) {
      single.current = null
      suppressClick.current = true
      cancelBoardGesture()
      // 接管全部触点，缩放使起始画板移出虚拟视口后仍收到松手事件。
      for (const id of points.keys()) viewport.setPointerCapture?.(id)
      setDragging(true)
      event.preventDefault()
      event.stopPropagation()
      return
    }
    if (touch) {
      single.current = {
        target,
        start,
        time: event.timeStamp,
        pan:
          handActive ||
          !target.closest('.artifact-canvas-board-title, .artifact-canvas-board-resize'),
        moveHeldBoard,
        moved: false,
      }
    }
    const capture = handActive ? viewport : (target.closest('button') ?? target)
    capture.setPointerCapture?.(event.pointerId)
    if (handActive) {
      viewport.focus({ preventScroll: true })
      event.preventDefault()
      event.stopPropagation()
      setDragging(true)
    }
  }

  const movePointer = (event: PointerEvent<HTMLElement>) => {
    const previous = pointers.current.get(event.pointerId)
    if (!previous) return
    const local = event.currentTarget.getBoundingClientRect()
    const next = { x: event.clientX - local.left, y: event.clientY - local.top }
    pointers.current.set(event.pointerId, next)
    const contact = single.current
    if (contact && !contact.moved) {
      // 指腹轻微抖动不应把点选或长按变成平移。
      if (Math.hypot(next.x - contact.start.x, next.y - contact.start.y) < TOUCH_SLOP) return
      contact.moved = true
      if (contact.pan && !handActive && event.timeStamp - contact.time >= HOLD_MS) {
        const anchor = { x: contact.start.x + local.left, y: contact.start.y + local.top }
        if (contact.moveHeldBoard(contact.target, event.pointerId, anchor)) {
          contact.pan = false
          suppressClick.current = true
        }
      }
      if (contact.pan) event.currentTarget.setPointerCapture?.(event.pointerId)
    }
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
    } else if (
      pointers.current.size === 1 &&
      (contact?.pan || (handActive && !suppressClick.current))
    ) {
      if (contact) {
        suppressClick.current = true
        setDragging(true)
      }
      updateCamera((current) => ({
        ...current,
        x: current.x + next.x - previous.x,
        y: current.y + next.y - previous.y,
        fit: null,
      }))
    }
  }

  const endPointer = (event: PointerEvent<HTMLElement>) => {
    if (!pointers.current.has(event.pointerId)) return
    const viewport = event.currentTarget
    if (
      event.type === 'lostpointercapture' &&
      event.target !== viewport &&
      viewport.hasPointerCapture?.(event.pointerId)
    )
      return
    const contact = single.current
    pointers.current.delete(event.pointerId)
    single.current = null
    if (!pointers.current.size) setDragging(false)
    if (event.type !== 'pointerup') {
      suppressClick.current = true
      return
    }
    const anchor = { x: event.clientX, y: event.clientY }
    if (contact && !contact.moved && !handActive && !suppressClick.current) {
      const rect = viewport.getBoundingClientRect()
      const dx = anchor.x - rect.left - contact.start.x
      const dy = anchor.y - rect.top - contact.start.y
      if (Math.hypot(dx, dy) >= TOUCH_SLOP) {
        if (contact.pan) suppressClick.current = true
      } else if (event.timeStamp - contact.time >= HOLD_MS && holdContent(contact.target, anchor)) {
        suppressClick.current = true
      }
    }
  }

  const blockClick = (event: MouseEvent<HTMLElement>) => {
    if (
      suppressClick.current &&
      event.detail !== 0 &&
      event.currentTarget.contains(event.target as Node)
    ) {
      event.preventDefault()
      event.stopPropagation()
    }
  }
  const blockTouchMenu = (event: MouseEvent<HTMLElement>) => {
    if (single.current || (pointers.current.size && suppressClick.current)) event.preventDefault()
  }

  return {
    dragging,
    wheelActive,
    startPointer,
    movePointer,
    endPointer,
    blockClick,
    blockTouchMenu,
    cancel,
  }
}
