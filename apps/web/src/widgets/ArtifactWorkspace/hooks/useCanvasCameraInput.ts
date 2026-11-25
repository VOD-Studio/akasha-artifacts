import {
  type PointerEvent,
  type RefObject,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from 'react'
import { type Camera, type Point, zoomCamera } from '../lib/canvas-camera'

interface CameraInputOptions {
  viewportRef: RefObject<HTMLElement | null>
  showOverview: boolean
  size: { width: number; height: number }
  invalidAddress: boolean
  pageId?: string
  handActive: boolean
  wheelLocked: boolean
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
  wheelLocked,
  updateCamera,
}: CameraInputOptions) {
  const wheelIdle = useRef<number | undefined>(undefined)
  const [wheelActive, setWheelActive] = useState(false)
  const pointers = useRef(new Map<number, Point>())
  const wasPinching = useRef(false)
  const [dragging, setDragging] = useState(false)
  useEffect(() => () => window.clearTimeout(wheelIdle.current), [])
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

  return { dragging, wheelActive, wasPinching, startPointer, movePointer, endPointer }
}
