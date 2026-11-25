import { resolveEffectiveProps } from '@akasha/kit'
import { parseArtboard, resolveArtboardTweaks } from '@akasha/protocol'
import { useEffect, useMemo, useRef } from 'react'
import { usePersistentControl } from '../../state/preserve'
import { useArtifactState } from '../../state/store'
import { tryInkSvg } from '../ink-svg'
import type { RendererProps } from '../registry'
import { artboardStyle } from './artboard-style'
import { DesignLayerScene } from './DesignLayerScene'
import { ParseErrorCard } from './parse-error'
import { SanitizedHtmlBox } from './sanitized-html'

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
