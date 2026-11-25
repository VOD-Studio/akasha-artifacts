import { applyVerifyState, parseVerify } from '@akasha/kit'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useArtifactState } from '../../state/store'
import type { RendererProps } from '../registry'
import { ParseErrorCard } from './parse-error'
import { SanitizedHtmlBox } from './sanitized-html'

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
