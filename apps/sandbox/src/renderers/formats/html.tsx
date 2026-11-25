import { injectHtmlLocations } from '@akasha/jsx-source'
import { useEffect, useRef } from 'react'
import { freezePreviewBitmaps } from '../../preview/bitmaps'
import { preparePrototypeMedia } from '../../prototype/media'
import type { RendererProps } from '../registry'
import { sanitizeMarkup } from '../sanitize'

/** 总览冻结预览位图后才通知已就绪；打印和播放保留原资源，不走总览缩略图。 */
export function HtmlRenderer({
  source,
  boardId,
  artboardView,
  version,
  preserved,
  onRendered,
}: RendererProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const onRenderedRef = useRef(onRendered)
  onRenderedRef.current = onRendered

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    // 对画板使用片段内行列；外壳不把它当成整份 artboard JSON 的编辑坐标。
    const instrumented = injectHtmlLocations(source).code
    const markup = sanitizeMarkup(instrumented, 'html')
    const rendered = () => {
      const cleanup = preserved.bindDomPersistence(el, window)
      onRenderedRef.current(version)
      return cleanup
    }
    if (!artboardView) {
      el.innerHTML = markup
      return rendered()
    }

    const template = el.ownerDocument.createElement('template')
    template.innerHTML = markup
    const fragment = template.content
    preparePrototypeMedia(fragment, artboardView === 'play')
    const mount = () => {
      el.replaceChildren(fragment)
      return rendered()
    }
    if (artboardView !== 'design') return mount()
    const controller = new AbortController()
    const pending = freezePreviewBitmaps(fragment, el.ownerDocument, controller.signal)
    if (!pending) return mount()
    el.replaceChildren()
    let cleanup: (() => void) | undefined
    void pending.then(() => {
      if (!controller.signal.aborted) cleanup = mount()
    })
    return () => {
      controller.abort()
      cleanup?.()
    }
  }, [source, version, preserved, artboardView])

  return (
    <div
      ref={containerRef}
      data-ak-renderer="html"
      data-ak-block={boardId}
      className={boardId ? 'ak-html-root min-h-screen' : 'ak-html-root p-4'}
    />
  )
}
