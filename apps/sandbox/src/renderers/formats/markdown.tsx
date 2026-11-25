import { marked } from 'marked'
import mermaid from 'mermaid'
import { useEffect, useRef } from 'react'
import { usePersistentControl } from '../../state/preserve'
import { tryInkSvg } from '../ink-svg'
import type { RendererProps } from '../registry'
import { sanitizeMarkup } from '../sanitize'
import { ensureMermaid } from './mermaid-runtime'

export function MarkdownRenderer({ source, preserved, onError, onRendered }: RendererProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [inklineEnabled, setInklineEnabled] = usePersistentControl('__md_inkline', true)
  const onErrorRef = useRef(onError)
  onErrorRef.current = onError
  const onRenderedRef = useRef(onRendered)
  onRenderedRef.current = onRendered

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    let cancelled = false

    const renderMarkdown = async () => {
      try {
        const html = await marked.parse(source, { gfm: true, breaks: false })
        if (cancelled) return
        el.innerHTML = sanitizeMarkup(html, 'html')

        // 将 Markdown 中的 ```mermaid 代码块升级为实时矢量图（可选 @violetjs/inkline 手绘风格）
        const mermaidBlocks = el.querySelectorAll('pre > code.language-mermaid')
        if (mermaidBlocks.length > 0) {
          ensureMermaid()
          let idx = 0
          for (const codeEl of mermaidBlocks) {
            const def = codeEl.textContent?.trim()
            if (!def) continue
            try {
              const { svg } = await mermaid.render(`ak-md-mmd-${Date.now()}-${idx++}`, def)
              if (cancelled) return
              const wrapper = document.createElement('div')
              wrapper.className = 'ak-mermaid-inline my-4 overflow-x-auto'
              wrapper.innerHTML = sanitizeMarkup(svg, 'svg')
              codeEl.parentElement?.replaceWith(wrapper)
              if (inklineEnabled) {
                tryInkSvg(wrapper.querySelector('svg'), idx + 1)
              }
            } catch {
              // 单个 Mermaid 块渲染失败时保留原代码块
            }
          }
        }
        onRenderedRef.current()
      } catch (err) {
        if (!cancelled) {
          onErrorRef.current({
            phase: 'compile',
            message: err instanceof Error ? err.message : String(err),
          })
        }
      }
    }

    const cleanup = preserved.bindDomPersistence(el)
    void renderMarkdown()
    return () => {
      cancelled = true
      cleanup()
    }
  }, [source, preserved, inklineEnabled])

  return (
    <div data-ak-renderer="markdown" className="p-6">
      <div className="mb-3 flex justify-end">
        <button
          type="button"
          onClick={() => setInklineEnabled((v) => !v)}
          className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50"
        >
          流程图风格：{inklineEnabled ? '手绘（Inkline）' : '标准矢量'}
        </button>
      </div>
      <article ref={containerRef} className="ak-markdown prose max-w-none" />
    </div>
  )
}
