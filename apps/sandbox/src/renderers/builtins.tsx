import { injectHtmlLocations } from '@akasha/jsx-source'
import { gpen, styles } from '@violetjs/inkline'
import { inkSvg } from '@violetjs/inkline/dom'
import { marked } from 'marked'
import mermaid from 'mermaid'
import {
  Component,
  type ComponentType,
  type ErrorInfo,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react'
import { preparePrototypeMedia } from '../prototype-media'
import { ArtifactCompileError, compileReactArtifact } from '../runtime/compiler'
import { usePersistentControl } from '../state/preserve'
import { DataStoryRenderer } from './data-story'
import {
  ArtboardRenderer,
  DocumentRenderer,
  LiveTimelineRenderer,
  OptionCompareRenderer,
  VerifyRenderer,
} from './kit-renderers'
import { PrWalkthroughRenderer } from './pr-walkthrough'
import { freezePreviewBitmaps } from './preview-bitmaps'
import { type RendererProps, registerRenderer } from './registry'
import { sanitizeMarkup } from './sanitize'

let mermaidInitialized = false

function ensureMermaid(): void {
  if (mermaidInitialized) return
  mermaidInitialized = true
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: 'neutral',
  })
}

function tryInkSvg(svgEl: SVGSVGElement | null, seed = 1): void {
  if (!svgEl) return
  // inkSvg 依赖真实浏览器布局测量（如 getBBox）；在无布局引擎的环境（如 jsdom）静默回退标准 SVG。
  if (typeof (svgEl as unknown as { getBBox?: unknown }).getBBox !== 'function') return
  try {
    inkSvg(svgEl, {
      style: { ...styles.draft, pen: gpen },
      seed,
    })
  } catch {
    // 某些特殊 SVG 图元无法手绘重描时保留原始矢量输出
  }
}

interface ErrorBoundaryProps {
  resetKey: string
  onError: RendererProps['onError']
  children: ReactNode
}

interface ErrorBoundaryState {
  error: Error | null
}

class ArtifactErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.props.onError({
      phase: 'runtime',
      message: error.message || String(error),
      stack: error.stack ?? info.componentStack ?? undefined,
    })
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps): void {
    if (prevProps.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null })
    }
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div
          role="alert"
          className="m-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"
        >
          <p className="font-semibold">Artifact 运行时错误</p>
          <pre className="mt-2 overflow-auto whitespace-pre-wrap font-mono text-xs">
            {this.state.error.message}
          </pre>
        </div>
      )
    }
    return this.props.children
  }
}

function HtmlRenderer({
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

function MarkdownRenderer({ source, preserved, onError, onRendered }: RendererProps) {
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

function MermaidRenderer({ source, onError, onRendered }: RendererProps) {
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

function SvgRenderer({ source, onError, onRendered }: RendererProps) {
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

function ReactRenderer({ source, version, preserved, onError, onRendered }: RendererProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [compiled, setCompiled] = useState<{
    source: string
    version: number
    Component: ComponentType
  } | null>(null)
  const [compileError, setCompileError] = useState<string | null>(null)
  const onErrorRef = useRef(onError)
  onErrorRef.current = onError
  const onRenderedRef = useRef(onRendered)
  onRenderedRef.current = onRendered

  useEffect(() => {
    let cancelled = false
    setCompileError(null)

    compileReactArtifact(source)
      .then((LoadedComponent) => {
        if (cancelled) return
        setCompiled({ source, version, Component: LoadedComponent })
      })
      .catch((err) => {
        if (cancelled) return
        const message = err instanceof Error ? err.message : String(err)
        const loc = err instanceof ArtifactCompileError ? err.loc : undefined
        setCompileError(message)
        onErrorRef.current({
          phase: 'compile',
          message,
          stack: err instanceof Error ? err.stack : undefined,
          loc,
        })
      })

    return () => {
      cancelled = true
    }
  }, [source, version])

  useEffect(() => {
    const el = hostRef.current
    if (!el || !compiled) return
    const cleanup = preserved.bindDomPersistence(el, window)
    onRenderedRef.current(compiled.version)
    return cleanup
  }, [compiled, preserved])

  if (compileError) {
    return (
      <div
        role="alert"
        data-ak-renderer="react"
        className="m-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"
      >
        <p className="font-semibold">编译失败</p>
        <pre className="mt-2 overflow-auto whitespace-pre-wrap font-mono text-xs">
          {compileError}
        </pre>
      </div>
    )
  }

  const ActiveComponent = compiled?.Component

  return (
    <div ref={hostRef} data-ak-renderer="react" className="ak-react-root min-h-full">
      {ActiveComponent ? (
        <ArtifactErrorBoundary
          resetKey={`${version}:${source}`}
          onError={(err) => onErrorRef.current(err)}
        >
          <ActiveComponent />
        </ArtifactErrorBoundary>
      ) : (
        <div className="p-6 text-xs text-slate-400">正在编译 React Artifact…</div>
      )}
    </div>
  )
}

let builtinsRegistered = false

/**
 * 注册 html、markdown、mermaid、svg、react 五类内置渲染器，以及全部 Kit 模板渲染器。
 *
 * @remarks 重复调用无效果。
 */
export function registerBuiltinRenderers(): void {
  if (builtinsRegistered) return
  builtinsRegistered = true
  registerRenderer('html', (props) => <HtmlRenderer {...props} />)
  registerRenderer('markdown', (props) => <MarkdownRenderer {...props} />)
  registerRenderer('mermaid', (props) => <MermaidRenderer {...props} />)
  registerRenderer('svg', (props) => <SvgRenderer {...props} />)
  registerRenderer('react', (props) => <ReactRenderer {...props} />)
  // M3 @akasha/kit 工程与高阶决策模板渲染器
  registerRenderer('document', (props) => <DocumentRenderer {...props} />)
  registerRenderer('artboard', (props) => <ArtboardRenderer {...props} />)
  registerRenderer('verify', (props) => <VerifyRenderer {...props} />)
  registerRenderer('live-timeline', (props) => <LiveTimelineRenderer {...props} />)
  registerRenderer('option-compare', (props) => <OptionCompareRenderer {...props} />)
  registerRenderer('pr-walkthrough', (props) => <PrWalkthroughRenderer {...props} />)
  registerRenderer('data-story', (props) => <DataStoryRenderer {...props} />)
}
