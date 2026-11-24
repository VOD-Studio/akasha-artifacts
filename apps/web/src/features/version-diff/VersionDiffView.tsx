import type { Version } from '@akasha/protocol'
import { Empty } from '@akasha/ui/empty'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@akasha/ui/select'
import { useEffect, useMemo, useState } from 'react'
import { computeLineDiff, type DiffLine } from '../../shared/lib/diff'

export interface VersionDiffViewProps {
  versions: readonly Version[]
  activeVersion: number
}

const LINE_STYLES = {
  added: { className: 'bg-emerald-50 text-emerald-950', mark: '+' },
  removed: { className: 'bg-red-50 text-red-950', mark: '-' },
  context: { className: 'text-ink', mark: ' ' },
}

function countChanges(lines: readonly DiffLine[]) {
  let added = 0
  let removed = 0
  for (const line of lines) {
    if (line.kind === 'added') added++
    if (line.kind === 'removed') removed++
  }
  return { added, removed }
}

function VersionSelect({
  label,
  versions,
  value,
  onChange,
}: {
  label: string
  versions: readonly Version[]
  value: number
  onChange: (version: number) => void
}) {
  return (
    <Select value={String(value)} onValueChange={(next) => onChange(Number(next))}>
      <SelectTrigger aria-label={label} controlSize="sm">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {versions.map((version) => (
          <SelectItem key={version.version} value={String(version.version)}>
            v{version.version} ({version.author})
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
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

  const before = sorted.find((v) => v.version === fromVersion) ?? sorted[0]
  const after = sorted.find((v) => v.version === toVersion) ?? sorted.at(-1)

  const diffLines = useMemo(
    () => computeLineDiff(before?.source ?? '', after?.source ?? ''),
    [before?.source, after?.source],
  )

  const stats = useMemo(() => countChanges(diffLines), [diffLines])

  if (sorted.length === 0) {
    return <Empty variant="plain" title="暂无可比较的版本" />
  }

  return (
    <div className="flex h-full flex-col bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-2.5 text-xs">
        <div className="flex items-center gap-2">
          <span className="text-ink-muted">版本对比</span>
          <VersionSelect
            label="基准版本"
            versions={sorted}
            value={before?.version ?? 1}
            onChange={setFromVersion}
          />
          <span aria-hidden="true" className="text-ink-muted">
            →
          </span>
          <VersionSelect
            label="目标版本"
            versions={sorted}
            value={after?.version ?? 1}
            onChange={setToVersion}
          />
        </div>
        <div className="flex items-center gap-3 font-mono">
          <span className="text-emerald-700">+{stats.added}</span>
          <span className="text-red-600">-{stats.removed}</span>
        </div>
      </div>

      <div className="flex-1 overflow-auto font-mono text-xs leading-5">
        {stats.added === 0 && stats.removed === 0 ? (
          <div className="p-8 text-center text-ink-muted">源码没有变化</div>
        ) : (
          <table className="w-full border-collapse">
            <tbody>
              {diffLines.map((line) => (
                <tr
                  key={`${line.kind}-${line.oldLine ?? 'n'}-${line.newLine ?? 'n'}`}
                  className={LINE_STYLES[line.kind].className}
                >
                  <td className="w-10 select-none border-r border-border/50 px-2 text-right text-ink-muted">
                    {line.oldLine ?? ''}
                  </td>
                  <td className="w-10 select-none border-r border-border/50 px-2 text-right text-ink-muted">
                    {line.newLine ?? ''}
                  </td>
                  <td className="w-5 select-none px-1.5 text-center font-semibold">
                    {LINE_STYLES[line.kind].mark}
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
