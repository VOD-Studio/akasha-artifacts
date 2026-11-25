import { useLayoutEffect, useState } from 'react'

/** 可见时测量视口，隐藏期间保留上次尺寸而不重置相机。 */
export function useViewportSize(ref: { current: HTMLElement | null }, visible: boolean) {
  const [size, setSize] = useState({ width: 0, height: 0 })
  useLayoutEffect(() => {
    const viewport = ref.current
    if (!visible || !viewport) return
    const measure = () => {
      const { clientWidth: width, clientHeight: height } = viewport
      setSize((prev) => (prev.width === width && prev.height === height ? prev : { width, height }))
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(viewport)
    return () => observer.disconnect()
  }, [ref, visible])
  return size
}
