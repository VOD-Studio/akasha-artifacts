import mermaid from 'mermaid'
import { useEffect, useId, useRef, useState } from 'react'
import { usePersistentControl } from '../../state/preserve'
import { tryInkSvg } from '../ink-svg'
import type { RendererProps } from '../registry'
import { sanitizeMarkup } from '../sanitize'
import { ensureMermaid } from './mermaid-runtime'

export function MermaidRenderer({ source, onError, onRendered }: RendererProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const rawId = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const [handDrawn, setHandDrawn] = usePersistentControl('__mermaid_inkline', true)
  const [renderError, setRenderError] = useState<string | null>(null)
  const onErrorRef = useRef(onError)
  onErrorRef.current = onError
  const onRenderedRef = useRef(onRendered)
  onRenderedRef.current = onRendered

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let cancelled = false
    setRenderError(null)

    const renderDiagram = async () => {
      try {
        ensureMermaid()
        const { svg } = await mermaid.render(`ak-mmd-${rawId}-${Date.now()}`, source)
        if (cancelled) return
        host.innerHTML = sanitizeMarkup(svg, 'svg')
        if (handDrawn) {
          // 必须先将 SVG 挂载到文档 DOM 中，再调用 @violetjs/inkline 的 inkSvg 原地重描手绘线条
          tryInkSvg(host.querySelector('svg'), 1)
        }
        onRenderedRef.current()
      } catch (err) {
        if (cancelled) return
        const message = err instanceof Error ? err.message : String(err)
        setRenderError(message)
        onErrorRef.current({ phase: 'compile', message })
      }
    }

    void renderDiagram()
    return () => {
      cancelled = true
    }
  }, [source, handDrawn, rawId])

  return (
    <div data-ak-renderer="mermaid" className="p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-slate-500">
          Mermaid 流程图 · {handDrawn ? 'Inkline 手绘风格' : '标准矢量风格'}
        </span>
        <button
          type="button"
          onClick={() => setHandDrawn((v) => !v)}
          className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
        >
          {handDrawn ? '切换为标准矢量' : '切换为手绘风格（Inkline）'}
        </button>
      </div>
      {renderError ? (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700"
        >
          Mermaid 解析失败：{renderError}
        </div>
      ) : null}
      <div
        ref={hostRef}
        className="flex min-h-[160px] items-center justify-center overflow-auto rounded-xl border border-slate-200/80 bg-white p-4"
      />
    </div>
  )
}
