import { useLayoutEffect } from 'react'

/** 让挂到 body 的输入浮层使用键盘上方的可见视口，不缩放或移动作品相机。 */
export function useVisualViewport(): void {
  useLayoutEffect(() => {
    const viewport = window.visualViewport
    if (!viewport) return
    const style = document.documentElement.style
    const update = () => {
      style.setProperty('--ak-visible-top', `${viewport.offsetTop}px`)
      style.setProperty('--ak-visible-left', `${viewport.offsetLeft}px`)
      style.setProperty('--ak-visible-width', `${viewport.width}px`)
      style.setProperty('--ak-visible-height', `${viewport.height}px`)
    }
    update()
    viewport.addEventListener('resize', update)
    viewport.addEventListener('scroll', update)
    return () => {
      viewport.removeEventListener('resize', update)
      viewport.removeEventListener('scroll', update)
      style.removeProperty('--ak-visible-top')
      style.removeProperty('--ak-visible-left')
      style.removeProperty('--ak-visible-width')
      style.removeProperty('--ak-visible-height')
    }
  }, [])
}
