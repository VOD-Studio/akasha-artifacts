import { useEffect, useRef } from 'react'
import { usePersistentControl } from '../../state/preserve'
import { tryInkSvg } from '../ink-svg'
import type { RendererProps } from '../registry'
import { sanitizeMarkup } from '../sanitize'

export function SvgRenderer({ source, onError, onRendered }: RendererProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [handDrawn, setHandDrawn] = usePersistentControl('__svg_inkline', false)
  const onErrorRef = useRef(onError)
  onErrorRef.current = onError
  const onRenderedRef = useRef(onRendered)
  onRenderedRef.current = onRendered

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    if (!/<svg\b/i.test(source)) {
      const message = 'SVG 源码缺少 <svg> 根元素'
      host.innerHTML = ''
      onErrorRef.current({ phase: 'compile', message })
      return
    }
    host.innerHTML = sanitizeMarkup(source, 'svg')
    if (handDrawn) {
      tryInkSvg(host.querySelector('svg'), 1)
    }
    onRenderedRef.current()
  }, [source, handDrawn])

  return (
    <div data-ak-renderer="svg" className="p-5">
      <div className="mb-3 flex items-center justify-end">
        <button
          type="button"
          onClick={() => setHandDrawn((v) => !v)}
          className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-50"
        >
          {handDrawn ? '标准 SVG' : 'Inkline 手绘描边'}
        </button>
      </div>
      <div
        ref={hostRef}
        className="flex min-h-[120px] items-center justify-center overflow-auto rounded-xl border border-slate-200/80 bg-white p-4"
      />
    </div>
  )
}
