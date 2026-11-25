import { applyLiveTimelineState, parseLiveTimeline } from '@akasha/kit'
import { useEffect, useMemo, useRef } from 'react'
import { useArtifactState } from '../../state/store'
import type { RendererProps } from '../registry'
import { ParseErrorCard } from './parse-error'

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
