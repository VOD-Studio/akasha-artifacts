import type { Version } from '@akasha/protocol'
import { Empty } from '@akasha/ui/empty'
import { useEffect, useMemo, useState } from 'react'
import { computeLineDiff } from '../../shared/lib/diff'

export interface VersionDiffViewProps {
  versions: readonly Version[]
  activeVersion: number
}

export function VersionDiffView({ versions, activeVersion }: VersionDiffViewProps) {
  const sorted = useMemo(() => [...versions].sort((a, b) => a.version - b.version), [versions])
  const defaultBase = Math.max(1, activeVersion - 1)
  const [fromVersion, setFromVersion] = useState<number>(defaultBase)
  const [toVersion, setToVersion] = useState<number>(activeVersion)

  useEffect(() => {
    setToVersion(activeVersion)
    setFromVersion(Math.max(1, activeVersion - 1))
  }, [activeVersion])

  const effectiveFrom = sorted.some((v) => v.version === fromVersion)
    ? fromVersion
    : (sorted[0]?.version ?? 1)
  const effectiveTo = sorted.some((v) => v.version === toVersion)
    ? toVersion
    : (sorted.at(-1)?.version ?? 1)

  const before = sorted.find((v) => v.version === effectiveFrom)
  const after = sorted.find((v) => v.version === effectiveTo)

  const diffLines = useMemo(
    () => computeLineDiff(before?.source ?? '', after?.source ?? ''),
    [before?.source, after?.source],
  )

  const stats = useMemo(() => {
    let added = 0
    let removed = 0
    for (const line of diffLines) {
      if (line.kind === 'added') added++
      if (line.kind === 'removed') removed++
    }
    return { added, removed }
  }, [diffLines])

  if (sorted.length === 0) {
    return (
      <Empty variant="plain" title="暂无版本源码" description="发布至少一个版本后可查看 Diff。" />
    )
  }

  return (
    <div className="flex h-full flex-col bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-2.5 text-xs">
        <div className="flex items-center gap-2">
          <span className="text-ink-muted">对比版本：</span>
          <select
            aria-label="基准版本"
            value={effectiveFrom}
            onChange={(e) => setFromVersion(Number(e.target.value))}
            className="rounded-md border border-border bg-surface px-2 py-1 font-mono text-xs text-ink"
          >
            {sorted.map((v) => (
              <option key={v.version} value={v.version}>
                v{v.version} ({v.author})
              </option>
            ))}
          </select>
          <span className="text-ink-muted">→</span>
          <select
            aria-label="目标版本"
            value={effectiveTo}
            onChange={(e) => setToVersion(Number(e.target.value))}
            className="rounded-md border border-border bg-surface px-2 py-1 font-mono text-xs text-ink"
          >
            {sorted.map((v) => (
              <option key={v.version} value={v.version}>
                v{v.version} ({v.author})
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-3 font-mono">
          <span className="text-emerald-700">+{stats.added}</span>
          <span className="text-red-600">-{stats.removed}</span>
        </div>
      </div>

      <div className="flex-1 overflow-auto font-mono text-xs leading-5">
        {stats.added === 0 && stats.removed === 0 ? (
          <div className="p-8 text-center text-ink-muted">所选两个版本源码完全一致</div>
        ) : (
          <table className="w-full border-collapse">
            <tbody>
              {diffLines.map((line) => (
                <tr
                  key={`${line.kind}-${line.oldLine ?? 'n'}-${line.newLine ?? 'n'}`}
                  className={
                    line.kind === 'added'
                      ? 'bg-emerald-50 text-emerald-950'
                      : line.kind === 'removed'
                        ? 'bg-red-50 text-red-950'
                        : 'text-ink'
                  }
                >
                  <td className="w-10 select-none border-r border-border/50 px-2 text-right text-ink-muted">
                    {line.oldLine ?? ''}
                  </td>
                  <td className="w-10 select-none border-r border-border/50 px-2 text-right text-ink-muted">
                    {line.newLine ?? ''}
                  </td>
                  <td className="w-5 select-none px-1.5 text-center font-semibold">
                    {line.kind === 'added' ? '+' : line.kind === 'removed' ? '-' : ' '}
                  </td>
                  <td className="whitespace-pre px-2">{line.text}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
