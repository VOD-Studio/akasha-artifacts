import { injectHtmlLocations } from '@akasha/jsx-source'
import {
  applyLiveTimelineState,
  applyVerifyState,
  parseDocument,
  parseLiveTimeline,
  parseOptionCompare,
  parseVerify,
  resolveEffectiveProps,
} from '@akasha/kit'
import { parseArtboard, resolveArtboardTweaks } from '@akasha/protocol'
import { gpen, styles } from '@violetjs/inkline'
import { inkSvg } from '@violetjs/inkline/dom'
import { useEffect, useMemo, useRef, useState } from 'react'
import { usePersistentControl } from '../state/preserve'
import { useArtifactState } from '../state/store'
import { artboardStyle } from './artboard-style'
import { DesignLayerScene } from './DesignLayerScene'
import type { RendererProps } from './registry'
import { sanitizeMarkup } from './sanitize'

function tryInkSvg(svgEl: SVGSVGElement | null, seed = 1): void {
  if (!svgEl) return
  if (typeof (svgEl as unknown as { getBBox?: unknown }).getBBox !== 'function') return
  try {
    inkSvg(svgEl, { style: { ...styles.draft, pen: gpen }, seed })
  } catch {
    // 无完整布局引擎或特殊图元回退标准 SVG
  }
}

function ParseErrorCard({ typeLabel, error }: { typeLabel: string; error: string }) {
  return (
    <div
      role="alert"
      data-ak-renderer="kit-error"
      className="m-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"
    >
      <p className="font-semibold">{typeLabel} 模板解析失败</p>
      <p className="mt-1 font-mono text-xs">{error}</p>
    </div>
  )
}

function SanitizedHtmlBox({ html, className }: { html: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!ref.current) return
    const instrumented = injectHtmlLocations(html).code
    ref.current.innerHTML = sanitizeMarkup(instrumented, 'html')
  }, [html])
  return <div ref={ref} className={className} />
}

// ============================================================================
// 1. LiveTimelineRenderer（live-timeline）
// ============================================================================

const TIMELINE_STATUS_META: Record<string, { label: string; dot: string; badge: string }> = {
  pending: { label: '待执行', dot: 'bg-slate-300', badge: 'bg-slate-100 text-slate-600' },
  running: {
    label: '进行中',
    dot: 'bg-violet-500 animate-pulse',
    badge: 'bg-violet-100 text-violet-700',
  },
  done: { label: '已完成', dot: 'bg-emerald-500', badge: 'bg-emerald-100 text-emerald-700' },
  failed: { label: '失败', dot: 'bg-rose-500', badge: 'bg-rose-100 text-rose-700' },
  skipped: { label: '已跳过', dot: 'bg-amber-400', badge: 'bg-amber-100 text-amber-700' },
}

export function LiveTimelineRenderer({ source, preserved, onRendered }: RendererProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const onRenderedRef = useRef(onRendered)
  onRenderedRef.current = onRendered
  const liveState = useArtifactState<Record<string, unknown>>()

  const parsed = useMemo(() => parseLiveTimeline(source), [source])
  const data = useMemo(
    () => (parsed.ok ? applyLiveTimelineState(parsed.data, liveState) : null),
    [parsed, liveState],
  )

  useEffect(() => {
    void source
    const el = containerRef.current
    if (!el) return
    const cleanup = preserved.bindDomPersistence(el, window)
    onRenderedRef.current()
    return cleanup
  }, [source, preserved])

  if (!parsed.ok || !data) {
    return <ParseErrorCard typeLabel="live-timeline" error={parsed.ok ? '' : parsed.error} />
  }

  const doneCount = data.steps.filter((s) => s.status === 'done' || s.status === 'skipped').length
  const pct = data.steps.length > 0 ? Math.round((doneCount / data.steps.length) * 100) : 0
  const visibleSteps =
    data.filterStatus === 'all'
      ? data.steps
      : data.steps.filter((s) => s.status === data.filterStatus)

  return (
    <div
      ref={containerRef}
      data-ak-renderer="live-timeline"
      className="mx-auto max-w-3xl space-y-4 p-6 text-slate-900"
    >
      <header className="space-y-1.5">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-lg font-semibold tracking-tight">{data.title}</h1>
          <span className="rounded-full bg-slate-100 px-2.5 py-0.5 font-mono text-xs text-slate-700">
            {doneCount}/{data.steps.length} · {pct}%
          </span>
        </div>
        {data.subtitle ? <p className="text-xs text-slate-500">{data.subtitle}</p> : null}
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
          <div
            className="h-full rounded-full bg-violet-600 transition-all duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>
      </header>

      <ol className="space-y-2.5">
        {visibleSteps.map((step, idx) => {
          const meta = TIMELINE_STATUS_META[step.status] ?? TIMELINE_STATUS_META.pending
          return (
            <li
              key={step.id}
              data-ak-block={step.id}
              className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-xs"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${meta?.dot ?? ''}`} />
                  <span className="font-mono text-[11px] text-slate-400">
                    {String(idx + 1).padStart(2, '0')}
                  </span>
                  <span className="text-sm font-medium text-slate-900">{step.title}</span>
                </div>
                <div className="flex items-center gap-2">
                  {step.durationMs !== undefined ? (
                    <span className="font-mono text-[11px] text-slate-500">
                      {step.durationMs}ms
                    </span>
                  ) : null}
                  <span
                    className={`rounded-md px-2 py-0.5 text-[11px] font-medium ${meta?.badge ?? ''}`}
                  >
                    {meta?.label ?? step.status}
                  </span>
                </div>
              </div>
              {step.detail ? <p className="mt-1.5 text-xs text-slate-600">{step.detail}</p> : null}
              {data.showOutputs && step.output ? (
                <pre className="mt-2 overflow-auto rounded-lg bg-slate-950 p-2.5 font-mono text-[11px] leading-5 text-slate-100">
                  {step.output}
                </pre>
              ) : null}
            </li>
          )
        })}
      </ol>
    </div>
  )
}

// ============================================================================
// 2. OptionCompareRenderer（option-compare）
// ============================================================================

export function OptionCompareRenderer({ source, preserved, onRendered }: RendererProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const onRenderedRef = useRef(onRendered)
  onRenderedRef.current = onRendered
  const liveState = useArtifactState<Record<string, unknown>>()

  const parsed = useMemo(() => parseOptionCompare(source), [source])
  const effective = useMemo(() => {
    if (!parsed.ok) return null
    const merged = resolveEffectiveProps(
      {
        title: parsed.data.title,
        highlightDiffs: parsed.data.highlightDiffs,
        compact: parsed.data.compact,
      },
      liveState,
    )
    return { ...parsed.data, ...merged }
  }, [parsed, liveState])

  useEffect(() => {
    void source
    const el = containerRef.current
    if (!el) return
    const cleanup = preserved.bindDomPersistence(el, window)
    onRenderedRef.current()
    return cleanup
  }, [source, preserved])

  if (!parsed.ok || !effective) {
    return <ParseErrorCard typeLabel="option-compare" error={parsed.ok ? '' : parsed.error} />
  }

  return (
    <div
      ref={containerRef}
      data-ak-renderer="option-compare"
      className="mx-auto max-w-5xl space-y-5 p-6 text-slate-900"
    >
      <header className="space-y-1">
        <h1 className="text-lg font-semibold tracking-tight">{effective.title}</h1>
        {effective.summary ? <p className="text-xs text-slate-600">{effective.summary}</p> : null}
      </header>

      <div
        className={`grid gap-4 ${
          effective.options.length <= 2
            ? 'grid-cols-1 md:grid-cols-2'
            : 'grid-cols-1 md:grid-cols-3'
        }`}
      >
        {effective.options.map((opt) => {
          const isRec = effective.recommended === opt.id || opt.recommended === true
          return (
            <section
              key={opt.id}
              data-ak-block={opt.id}
              className={`rounded-xl border ${effective.compact ? 'p-3' : 'p-4'} ${
                isRec
                  ? 'border-violet-400 bg-violet-50/40 ring-1 ring-violet-200'
                  : 'border-slate-200 bg-white'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-slate-900">{opt.title}</h2>
                {isRec ? (
                  <span className="rounded-full bg-violet-600 px-2 py-0.5 text-[10px] font-medium text-white">
                    推荐
                  </span>
                ) : null}
              </div>
              {opt.summary ? <p className="mt-1 text-xs text-slate-600">{opt.summary}</p> : null}
              {!effective.compact && opt.pros && opt.pros.length > 0 ? (
                <ul className="mt-2.5 space-y-1 text-xs text-emerald-800">
                  {opt.pros.map((p) => (
                    <li key={p}>+ {p}</li>
                  ))}
                </ul>
              ) : null}
              {!effective.compact && opt.cons && opt.cons.length > 0 ? (
                <ul className="mt-2 space-y-1 text-xs text-rose-700">
                  {opt.cons.map((c) => (
                    <li key={c}>- {c}</li>
                  ))}
                </ul>
              ) : null}
            </section>
          )
        })}
      </div>

      {effective.dimensions.length > 0 ? (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <th className="px-3 py-2 font-semibold text-slate-600">评估维度</th>
                {effective.options.map((opt) => (
                  <th key={opt.id} className="px-3 py-2 font-semibold text-slate-900">
                    {opt.title}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {effective.dimensions.map((dim) => {
                const rowVals = effective.options.map((o) => o.values?.[dim.id] ?? '—')
                const hasDiff = new Set(rowVals).size > 1
                return (
                  <tr
                    key={dim.id}
                    data-ak-block={`dim:${dim.id}`}
                    className={`border-b border-slate-100 last:border-0 ${
                      effective.highlightDiffs && hasDiff ? 'bg-amber-50/40' : ''
                    }`}
                  >
                    <td className="px-3 py-2 font-medium text-slate-700">{dim.label}</td>
                    {effective.options.map((opt) => (
                      <td key={opt.id} className="px-3 py-2 text-slate-700">
                        {opt.values?.[dim.id] ?? '—'}
                      </td>
                    ))}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  )
}

// ============================================================================
// 3. ArtboardRenderer（artboard）
// ============================================================================

export function ArtboardRenderer({ source, preserved, onRendered }: RendererProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const flowSvgRef = useRef<SVGSVGElement>(null)
  const onRenderedRef = useRef(onRendered)
  onRenderedRef.current = onRendered
  const liveState = useArtifactState<Record<string, unknown>>()

  const parsed = useMemo(() => parseArtboard(source), [source])
  const effective = useMemo(() => {
    if (!parsed.ok) return null
    const merged = resolveEffectiveProps(
      {
        columns: parsed.data.columns,
        showFlows: parsed.data.showFlows,
        handDrawnFlows: parsed.data.handDrawnFlows,
      },
      liveState,
    )
    return {
      ...parsed.data,
      columns: Math.min(4, Math.max(1, Math.round(Number(merged.columns) || parsed.data.columns))),
      showFlows: Boolean(merged.showFlows),
      handDrawnFlows: Boolean(merged.handDrawnFlows),
    }
  }, [parsed, liveState])

  const defaultPage = parsed.ok ? (parsed.data.pages[0]?.id ?? '__all__') : '__all__'
  const [activePage, setActivePage] = usePersistentControl('__artboard_page', defaultPage)

  useEffect(() => {
    void source
    void activePage
    const el = containerRef.current
    if (!el) return
    const cleanup = preserved.bindDomPersistence(el, window)
    onRenderedRef.current()
    return cleanup
  }, [source, preserved, activePage])

  useEffect(() => {
    if (effective?.showFlows && effective.handDrawnFlows && effective.flows.length > 0) {
      tryInkSvg(flowSvgRef.current, 3)
    }
  }, [effective?.showFlows, effective?.handDrawnFlows, effective?.flows.length])

  if (!parsed.ok || !effective) {
    return <ParseErrorCard typeLabel="artboard" error={parsed.ok ? '' : parsed.error} />
  }

  const hasUnassignedOverview =
    effective.pages.length > 0 &&
    effective.pages.every((page) => page.includeSharedBoards === false) &&
    effective.boards.some((board) => !board.pageId)
  const pages: typeof effective.pages = hasUnassignedOverview
    ? [...effective.pages, { id: '', title: '未分组' }]
    : effective.pages
  const page = pages.find((entry) => entry.id === activePage) ?? pages[0]
  const resolvedActivePage = page?.id ?? '__all__'
  const visibleBoards = page
    ? effective.boards.filter((board) =>
        board.pageId ? board.pageId === page.id : page.includeSharedBoards !== false,
      )
    : effective.boards

  const visibleBoardIds = new Set(visibleBoards.map((b) => b.id))
  const visibleFlows = page
    ? effective.flows.filter((f) => visibleBoardIds.has(f.from) || visibleBoardIds.has(f.to))
    : effective.flows

  const boardTitleById = new Map(effective.boards.map((b) => [b.id, b.title]))
  const colsClass =
    effective.columns === 1
      ? 'grid-cols-1'
      : effective.columns === 3
        ? 'grid-cols-1 md:grid-cols-3'
        : effective.columns === 4
          ? 'grid-cols-1 md:grid-cols-2 xl:grid-cols-4'
          : 'grid-cols-1 md:grid-cols-2'

  return (
    <div
      ref={containerRef}
      data-ak-renderer="artboard"
      className="min-h-screen space-y-5 bg-slate-50/70 p-6 text-slate-900"
    >
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">{effective.title}</h1>
          {effective.subtitle ? (
            <p className="text-xs text-slate-500">{effective.subtitle}</p>
          ) : null}
        </div>
        {pages.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="画板页面">
            {pages.map((p) => (
              <button
                key={p.id}
                type="button"
                role="tab"
                aria-selected={resolvedActivePage === p.id}
                onClick={() => setActivePage(p.id)}
                className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${
                  resolvedActivePage === p.id
                    ? 'bg-violet-600 text-white'
                    : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
                }`}
              >
                {p.title}
              </button>
            ))}
          </div>
        ) : null}
      </header>

      {visibleBoards.length === 0 ? <p className="text-sm text-slate-500">此页面没有画板</p> : null}

      <div className={`grid gap-4 ${colsClass}`}>
        {visibleBoards.map((board) => (
          <article
            key={board.id}
            data-ak-block={board.id}
            className={`flex flex-col overflow-hidden rounded-2xl border bg-white shadow-xs ${
              board.recommended ? 'border-violet-400 ring-2 ring-violet-100' : 'border-slate-200'
            }`}
          >
            <div className="flex items-center justify-between gap-2 border-b border-slate-100 bg-slate-50/70 px-3.5 py-2.5">
              <div className="min-w-0">
                <h2 className="truncate text-sm font-semibold text-slate-900">{board.title}</h2>
                {board.subtitle ? (
                  <p className="truncate text-[11px] text-slate-500">{board.subtitle}</p>
                ) : null}
              </div>
              {board.recommended ? (
                <span className="shrink-0 rounded-full bg-violet-600 px-2 py-0.5 text-[10px] font-medium text-white">
                  推荐方案
                </span>
              ) : null}
            </div>
            <div className="flex-1 p-4">
              <div
                className="relative overflow-hidden"
                style={{
                  ...(board.designLayers?.length && {
                    height: board.viewport?.height ?? 800,
                    width: board.viewport?.width ?? 1280,
                  }),
                  ...artboardStyle(
                    board.appearance,
                    board.tweaks?.length ? resolveArtboardTweaks(board.tweaks) : undefined,
                  ),
                }}
              >
                {board.html && <SanitizedHtmlBox html={board.html} className="text-sm" />}
                {!board.html && (
                  <p className="text-xs leading-relaxed text-slate-600">
                    {board.description ?? '空白画板'}
                  </p>
                )}
                {!!board.designLayers?.length && (
                  <DesignLayerScene layers={board.designLayers} interactive={false} />
                )}
              </div>
            </div>
            {board.tags && board.tags.length > 0 ? (
              <div className="flex flex-wrap gap-1.5 border-t border-slate-100 px-3.5 py-2">
                {board.tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-600"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            ) : null}
          </article>
        ))}
      </div>

      {effective.showFlows && visibleFlows.length > 0 ? (
        <section
          aria-label="页面流程连线"
          className="rounded-xl border border-slate-200 bg-white p-4"
        >
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-xs font-semibold text-slate-700">页面流程连线</h2>
            {effective.handDrawnFlows ? (
              <span className="rounded bg-violet-50 px-1.5 py-0.5 text-[10px] text-violet-700">
                Inkline 手绘风格
              </span>
            ) : null}
          </div>
          <svg
            ref={flowSvgRef}
            role="img"
            aria-label="页面流程连线图"
            viewBox={`0 0 640 ${Math.max(56, visibleFlows.length * 46)}`}
            className="w-full max-w-2xl"
          >
            <title>页面流程连线图</title>
            {visibleFlows.map((flow, idx) => {
              const y = 26 + idx * 44
              const fromLabel = boardTitleById.get(flow.from) ?? flow.from
              const toLabel = boardTitleById.get(flow.to) ?? flow.to
              return (
                <g key={`${flow.from}->${flow.to}:${flow.label ?? ''}`}>
                  <rect
                    x="8"
                    y={y - 14}
                    width="180"
                    height="28"
                    rx="6"
                    fill="#f8fafc"
                    stroke="#cbd5e1"
                  />
                  <text x="98" y={y + 4} textAnchor="middle" fontSize="11" fill="#0f172a">
                    {fromLabel}
                  </text>
                  <line x1="194" y1={y} x2="438" y2={y} stroke="#7c3aed" strokeWidth="1.5" />
                  <polygon points={`444,${y} 436,${y - 4} 436,${y + 4}`} fill="#7c3aed" />
                  {flow.label ? (
                    <text x="316" y={y - 6} textAnchor="middle" fontSize="10" fill="#6d28d9">
                      {flow.label}
                    </text>
                  ) : null}
                  <rect
                    x="450"
                    y={y - 14}
                    width="180"
                    height="28"
                    rx="6"
                    fill="#f5f3ff"
                    stroke="#c4b5fd"
                  />
                  <text x="540" y={y + 4} textAnchor="middle" fontSize="11" fill="#4c1d95">
                    {toLabel}
                  </text>
                </g>
              )
            })}
          </svg>
        </section>
      ) : null}
    </div>
  )
}

// ============================================================================
// 4. DocumentRenderer（document：JSON 稳定块结构 + HTML 双格式兼容）
// ============================================================================

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

// ============================================================================
// 5. VerifyRenderer（verify：预期/实际对比 + 可展开原始证据 + 未验证项清单）
// ============================================================================

const CLAIM_STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  checked: { label: '已验证', cls: 'bg-emerald-100 text-emerald-800' },
  updated: { label: '已修复待重验', cls: 'bg-violet-100 text-violet-800' },
  failed: { label: '验证失败', cls: 'bg-rose-100 text-rose-800' },
  pending: { label: '待验证', cls: 'bg-slate-100 text-slate-600' },
}

const VERDICT_BADGE: Record<string, { label: string; cls: string }> = {
  pass: { label: 'Pass', cls: 'bg-emerald-600 text-white' },
  reject: { label: 'Reject', cls: 'bg-rose-600 text-white' },
  waive: { label: 'Waive', cls: 'bg-amber-500 text-white' },
}

export function VerifyRenderer({ source, preserved, onRendered }: RendererProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const onRenderedRef = useRef(onRendered)
  onRenderedRef.current = onRendered
  const liveState = useArtifactState<Record<string, unknown>>()
  const [expandedEvidence, setExpandedEvidence] = useState<Record<string, boolean>>({})

  const parsed = useMemo(() => parseVerify(source), [source])
  const data = useMemo(
    () => (parsed.ok ? applyVerifyState(parsed.data, liveState) : null),
    [parsed, liveState],
  )

  useEffect(() => {
    void source
    const el = containerRef.current
    if (!el) return
    const cleanup = preserved.bindDomPersistence(el, window)
    onRenderedRef.current()
    return cleanup
  }, [source, preserved])

  if (!parsed.ok || !data) {
    return <ParseErrorCard typeLabel="verify" error={parsed.ok ? '' : parsed.error} />
  }

  const visibleClaims =
    data.filterStatus === 'all'
      ? data.claims
      : data.claims.filter((c) => c.status === data.filterStatus)

  return (
    <div
      ref={containerRef}
      data-ak-renderer="verify"
      className="mx-auto max-w-5xl space-y-6 p-6 text-slate-900"
    >
      <header className="space-y-1">
        <h1 className="text-lg font-semibold tracking-tight">{data.title}</h1>
        {data.summary ? <p className="text-xs text-slate-600">{data.summary}</p> : null}
      </header>

      {data.screens.length > 0 ? (
        <section className="space-y-3" aria-label="设计稿与实际界面对比">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            预期稿 vs 实际构建结果
          </h2>
          {data.screens.map((scr) => (
            <div
              key={scr.id}
              data-ak-block={scr.id}
              className="rounded-xl border border-slate-200 bg-white p-4"
            >
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-900">{scr.title}</h3>
                {scr.diffNote ? (
                  <span className="text-xs text-slate-500">{scr.diffNote}</span>
                ) : null}
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3">
                  <div className="mb-2 text-[11px] font-medium text-slate-500">
                    {scr.expectedLabel}
                  </div>
                  {scr.expectedHtml ? <SanitizedHtmlBox html={scr.expectedHtml} /> : null}
                </div>
                <div className="rounded-lg border border-emerald-200 bg-emerald-50/30 p-3">
                  <div className="mb-2 text-[11px] font-medium text-emerald-700">
                    {scr.actualLabel}
                  </div>
                  {scr.actualHtml ? <SanitizedHtmlBox html={scr.actualHtml} /> : null}
                </div>
              </div>
            </div>
          ))}
        </section>
      ) : null}

      <section className="space-y-2.5" aria-label="可验证交付声明">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          可验证声明（{visibleClaims.length}）
        </h2>
        {visibleClaims.map((claim) => {
          const st = CLAIM_STATUS_BADGE[claim.status] ?? CLAIM_STATUS_BADGE.checked
          const vd = claim.verdict ? VERDICT_BADGE[claim.verdict] : undefined
          const isOpen = Boolean(expandedEvidence[claim.id])
          return (
            <div
              key={claim.id}
              data-ak-block={claim.id}
              className="rounded-xl border border-slate-200 bg-white p-3.5"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span
                    className={`rounded-md px-2 py-0.5 text-[11px] font-medium ${st?.cls ?? ''}`}
                  >
                    {st?.label ?? claim.status}
                  </span>
                  <span className="text-sm font-medium text-slate-900">{claim.title}</span>
                </div>
                <div className="flex items-center gap-2">
                  {vd ? (
                    <span className={`rounded-md px-2 py-0.5 text-[11px] font-semibold ${vd.cls}`}>
                      {vd.label}
                    </span>
                  ) : null}
                  {claim.evidence ? (
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedEvidence((prev) => ({ ...prev, [claim.id]: !prev[claim.id] }))
                      }
                      className="rounded-md border border-slate-200 px-2 py-0.5 text-[11px] text-slate-700 hover:bg-slate-50"
                    >
                      {isOpen ? '收起证据' : '展开原始证据'}
                    </button>
                  ) : null}
                </div>
              </div>
              {claim.summary ? (
                <p className="mt-1.5 text-xs text-slate-600">{claim.summary}</p>
              ) : null}
              {claim.command ? (
                <div className="mt-1.5 font-mono text-[11px] text-slate-500">$ {claim.command}</div>
              ) : null}
              {isOpen && claim.evidence ? (
                <pre
                  data-testid={`verify-evidence-${claim.id}`}
                  className="mt-2 overflow-auto rounded-lg bg-slate-950 p-3 font-mono text-[11px] leading-5 text-slate-100"
                >
                  {claim.evidence}
                </pre>
              ) : null}
            </div>
          )
        })}
      </section>

      {data.showUnverified && data.unverified.length > 0 ? (
        <section
          aria-label="未验证项清单"
          className="rounded-xl border border-amber-200 bg-amber-50/70 p-4"
        >
          <h2 className="text-xs font-semibold text-amber-900">
            未验证项清单（{data.unverified.length}）
          </h2>
          <ul className="mt-2 space-y-2">
            {data.unverified.map((item) => (
              <li
                key={item.id}
                data-ak-block={item.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white/80 px-3 py-2 text-xs"
              >
                <div>
                  <span className="font-medium text-slate-900">{item.title}</span>
                  <span className="ml-2 text-slate-600">— {item.reason}</span>
                </div>
                <span className="rounded bg-amber-100 px-1.5 py-0.5 font-mono text-[10px] text-amber-800">
                  风险: {item.risk}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}
