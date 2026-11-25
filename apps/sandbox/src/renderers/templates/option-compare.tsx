import { parseOptionCompare, resolveEffectiveProps } from '@akasha/kit'
import { useEffect, useMemo, useRef } from 'react'
import { useArtifactState } from '../../state/store'
import type { RendererProps } from '../registry'
import { ParseErrorCard } from './parse-error'

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
