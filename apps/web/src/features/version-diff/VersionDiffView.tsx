import type { Version, VersionSummary } from '@akasha/protocol'
import { Button } from '@akasha/ui/button'
import { Empty } from '@akasha/ui/empty'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@akasha/ui/select'
import { type ReactNode, useEffect, useMemo, useState } from 'react'
import { useArtifactSourceQuery } from '@/entities/artifact'
import { computeLineDiff, type DiffLine } from '@/shared/lib/diff'

export interface VersionDiffViewProps {
  versions: readonly VersionSummary[]
  activeVersion: number
}

const LINE_STYLES = {
  added: { className: 'bg-emerald-50 text-emerald-950', mark: '+' },
  removed: { className: 'bg-red-50 text-red-950', mark: '-' },
  context: { className: 'text-ink', mark: ' ' },
}

function hasVersionSource(version: VersionSummary): version is Version {
  return 'source' in version && typeof version.source === 'string'
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
  versions: readonly VersionSummary[]
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

  if (!before || !after) {
    return <Empty variant="plain" title="暂无可比较的版本" />
  }

  const selectors = (
    <div className="flex items-center gap-2">
      <span className="text-ink-muted">版本对比</span>
      <VersionSelect
        label="基准版本"
        versions={sorted}
        value={before.version}
        onChange={setFromVersion}
      />
      <span aria-hidden="true" className="text-ink-muted">
        →
      </span>
      <VersionSelect
        label="目标版本"
        versions={sorted}
        value={after.version}
        onChange={setToVersion}
      />
    </div>
  )

  // 混有摘要时保持查询视图挂载，切换对比项不会重建下拉控件。
  if (hasVersionSource(before) && hasVersionSource(after) && sorted.every(hasVersionSource)) {
    return <VersionDiffResult selectors={selectors} before={before.source} after={after.source} />
  }
  return <QueriedVersionDiff selectors={selectors} before={before} after={after} />
}

function QueriedVersionDiff({
  selectors,
  before,
  after,
}: {
  selectors: ReactNode
  before: VersionSummary
  after: VersionSummary
}) {
  const inlineBefore = hasVersionSource(before) ? before.source : undefined
  const inlineAfter = hasVersionSource(after) ? after.source : undefined
  // 两边选中同一个版本时，源码只读一次。
  const sameVersion = before === after
  const beforeQuery = useArtifactSourceQuery(
    before.artifactId,
    before.version,
    inlineBefore === undefined,
  )
  const afterQuery = useArtifactSourceQuery(
    after.artifactId,
    after.version,
    !sameVersion && inlineAfter === undefined,
  )
  const failedBefore = inlineBefore === undefined && beforeQuery.isError
  const failedAfter = !sameVersion && inlineAfter === undefined && afterQuery.isError
  if (failedBefore || failedAfter) {
    const error = failedBefore ? beforeQuery.error : afterQuery.error
    return (
      <VersionDiffResult
        selectors={selectors}
        status={
          <div role="alert" className="flex flex-wrap items-center justify-center gap-2 p-8">
            <span className="text-error">无法读取对比版本：{error?.message}</span>
            <Button
              variant="ghost"
              size="sm"
              loading={beforeQuery.isFetching || afterQuery.isFetching}
              onClick={() => {
                if (failedBefore) void beforeQuery.refetch()
                if (failedAfter) void afterQuery.refetch()
              }}
            >
              重试
            </Button>
          </div>
        }
      />
    )
  }

  const beforeSource = inlineBefore ?? beforeQuery.data?.source
  const afterSource = sameVersion ? beforeSource : (inlineAfter ?? afterQuery.data?.source)
  return (
    <VersionDiffResult
      selectors={selectors}
      before={beforeSource}
      after={afterSource}
      status={
        <p role="status" className="p-8 text-center text-ink-muted">
          正在读取对比版本…
        </p>
      }
    />
  )
}

function VersionDiffResult({
  selectors,
  before,
  after,
  status,
}: {
  selectors: ReactNode
  before?: string
  after?: string
  status?: ReactNode
}) {
  const comparison = useMemo(() => {
    if (before === undefined || after === undefined) return null
    const lines = before === after ? [] : computeLineDiff(before, after)
    return { ...countChanges(lines), lines }
  }, [before, after])
  const unchanged = comparison?.added === 0 && comparison.removed === 0

  return (
    <div className="flex h-full flex-col bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-2.5 text-xs">
        {selectors}
        {comparison && (
          <div className="flex items-center gap-3 font-mono">
            <span className="text-emerald-700">+{comparison.added}</span>
            <span className="text-red-600">-{comparison.removed}</span>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-auto font-mono text-xs leading-5">
        {!comparison && status}
        {unchanged && <div className="p-8 text-center text-ink-muted">源码没有变化</div>}
        {comparison && !unchanged && (
          <table className="w-full border-collapse">
            <tbody>
              {comparison.lines.map((line) => (
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
