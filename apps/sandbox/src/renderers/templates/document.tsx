import { injectHtmlLocations } from '@akasha/jsx-source'
import { parseDocument, resolveEffectiveProps } from '@akasha/kit'
import { useEffect, useMemo, useRef } from 'react'
import { useArtifactState } from '../../state/store'
import type { RendererProps } from '../registry'
import { sanitizeMarkup } from '../sanitize'
import { ParseErrorCard } from './parse-error'

export function DocumentRenderer({ source, preserved, onRendered }: RendererProps) {
  const htmlContainerRef = useRef<HTMLDivElement>(null)
  const jsonContainerRef = useRef<HTMLElement>(null)
  const onRenderedRef = useRef(onRendered)
  onRenderedRef.current = onRendered
  const liveState = useArtifactState<Record<string, unknown>>()

  const parsed = useMemo(() => parseDocument(source), [source])
  const editsMap = useMemo(() => {
    const raw = liveState?.edits
    return raw && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Record<string, string>)
      : {}
  }, [liveState])

  useEffect(() => {
    void source
    if (!parsed.ok) return
    if (parsed.data.format === 'html') {
      const el = htmlContainerRef.current
      if (!el) return
      const instrumented = injectHtmlLocations(parsed.data.html).code
      el.innerHTML = sanitizeMarkup(instrumented, 'html')
      const cleanup = preserved.bindDomPersistence(el, window)
      onRenderedRef.current()
      return () => {
        cleanup()
        el.innerHTML = ''
      }
    }
    const el = jsonContainerRef.current
    if (!el) return
    const cleanup = preserved.bindDomPersistence(el, window)
    onRenderedRef.current()
    return cleanup
  }, [source, parsed, preserved])

  if (!parsed.ok) {
    return <ParseErrorCard typeLabel="document" error={parsed.error} />
  }

  // 使用独立 key 隔离命令式 innerHTML 节点与声明式 JSON 文档节点，避免格式切换时残留旧 DOM 与旧批注锚点。
  if (parsed.data.format === 'html') {
    return (
      <article
        key="document-html"
        data-ak-renderer="document"
        className="prose prose-slate mx-auto max-w-3xl p-6"
      >
        <div ref={htmlContainerRef} />
      </article>
    )
  }

  const effective = resolveEffectiveProps(
    { density: parsed.data.density, showQuestions: parsed.data.showQuestions },
    liveState,
  )
  const isCompact = effective.density === 'compact'

  return (
    <article
      key="document-json"
      ref={jsonContainerRef}
      data-ak-renderer="document"
      className={`mx-auto max-w-3xl p-6 text-slate-900 ${isCompact ? 'space-y-4' : 'space-y-6'}`}
    >
      <header className="border-b border-slate-200 pb-4">
        <h1 className="text-xl font-semibold tracking-tight">{parsed.data.title}</h1>
        {parsed.data.subtitle ? (
          <p className="mt-1 text-xs text-slate-500">{parsed.data.subtitle}</p>
        ) : null}
      </header>

      {parsed.data.sections.map((sec) => (
        <section
          key={sec.id}
          data-ak-block={sec.id}
          className={isCompact ? 'space-y-2' : 'space-y-3'}
        >
          <h2 className="text-base font-semibold text-slate-900">{sec.heading}</h2>
          {sec.paragraphs.map((p) => {
            const humanEdited = editsMap[p.id]
            const isModified = humanEdited !== undefined && humanEdited !== p.text
            return (
              <div
                key={p.id}
                data-ak-block={p.id}
                className={`rounded-lg px-2.5 py-1.5 ${
                  isModified ? 'border border-amber-300 bg-amber-50/50' : ''
                }`}
              >
                {isModified ? (
                  <div className="mb-1 flex items-center gap-1.5 text-[10px] font-medium text-amber-800">
                    <span>人工已改稿</span>
                    <span className="line-through text-slate-400">{p.text}</span>
                  </div>
                ) : null}
                <p className="text-sm leading-7 text-slate-700">
                  {isModified ? humanEdited : p.text}
                </p>
              </div>
            )
          })}

          {effective.showQuestions && sec.questions.length > 0 ? (
            <div className="space-y-2 pt-1">
              {sec.questions.map((q) => (
                <aside
                  key={q.id}
                  data-ak-block={q.id}
                  className="rounded-xl border border-violet-200 bg-violet-50/60 px-3.5 py-2.5 text-xs"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-violet-900">Agent 行内提问</span>
                    <span className="rounded bg-white px-1.5 py-0.5 text-[10px] text-violet-700">
                      {q.status === 'answered' ? '已回答' : '待确认'}
                    </span>
                  </div>
                  <p className="mt-1 text-violet-950">{q.prompt}</p>
                  {q.answer ? <p className="mt-1 text-slate-700">答复：{q.answer}</p> : null}
                </aside>
              ))}
            </div>
          ) : null}
        </section>
      ))}
    </article>
  )
}
