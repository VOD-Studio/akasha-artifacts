import { Badge } from '@akasha/ui/badge'
import { Button } from '@akasha/ui/button'
import { AlertTriangle, Check, RefreshCw } from 'lucide-react'
import { useMemo } from 'react'
import { computeLineDiff } from '@/shared/lib/diff'

export interface EditorConflictState {
  reason: 'http_409' | 'remote_updated'
  baseVersion: number
  headVersion: number
  authors: string[]
  /** 409 响应里服务端给出的差异。 */
  serverDiff?: string
  /** 远端最新版本的源码。 */
  remoteSource?: string
  localSource: string
}

export interface ConflictResolutionBannerProps {
  conflict: EditorConflictState
  saving?: boolean
  onAdoptLatest: () => void
  onSaveMerged: () => void
  onDismiss?: () => void
}

/**
 * 并发版本冲突横幅：展示落后的基线与最新版本的作者及逐行差异。
 *
 * @remarks 支持直接加载最新版本，或以最新版本为基线合并保存。
 */
export function ConflictResolutionBanner({
  conflict,
  saving = false,
  onAdoptLatest,
  onSaveMerged,
  onDismiss,
}: ConflictResolutionBannerProps) {
  const { serverDiff, remoteSource, localSource } = conflict
  const computedLines = useMemo(() => {
    if (serverDiff || remoteSource === undefined) return []
    return computeLineDiff(remoteSource, localSource).filter((line) => line.kind !== 'context')
  }, [serverDiff, remoteSource, localSource])

  const authorSummary =
    conflict.authors.length > 0 ? conflict.authors.join('、') : '其他协作者或 Agent'

  return (
    <div
      role="alert"
      data-testid="version-conflict-banner"
      className="shrink-0 border-b border-amber-300 bg-amber-50/90 px-3.5 py-2.5 text-xs text-amber-950"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <AlertTriangle size={14} className="shrink-0 text-amber-700" />
          <span className="font-semibold">有更新的版本</span>
          <Badge tone="warning">
            草稿基于 v{conflict.baseVersion}，最新 v{conflict.headVersion}
          </Badge>
          <span className="text-[11px] text-amber-800">更新者：{authorSummary}</span>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            variant="outline"
            size="sm"
            leftIcon={<RefreshCw size={12} />}
            disabled={saving}
            onClick={onAdoptLatest}
          >
            放弃草稿并打开最新
          </Button>
          <Button
            variant="primary"
            size="sm"
            leftIcon={<Check size={12} />}
            loading={saving}
            onClick={onSaveMerged}
          >
            将草稿保存为新版本
          </Button>
          {onDismiss ? (
            <Button variant="ghost" size="sm" onClick={onDismiss}>
              稍后处理
            </Button>
          ) : null}
        </div>
      </div>
      <p className="mt-1 text-amber-800">保存草稿不会合并最新版本的改动。</p>

      {serverDiff && (
        <pre
          data-testid="conflict-server-diff"
          className="mt-2 max-h-36 overflow-auto rounded-lg border border-amber-200 bg-white/90 p-2 font-mono text-[11px] leading-5 text-slate-800"
        >
          {serverDiff}
        </pre>
      )}
      {!serverDiff && computedLines.length > 0 && (
        <div
          data-testid="conflict-computed-diff"
          className="mt-2 max-h-36 overflow-auto rounded-lg border border-amber-200 bg-white/90 p-2 font-mono text-[11px] leading-5"
        >
          <div className="mb-1 text-[10px] font-sans text-slate-500">
            − 最新 v{conflict.headVersion} / + 你的草稿
          </div>
          {computedLines.slice(0, 40).map((line) => (
            <div
              key={`${line.kind}-${line.oldLine ?? 'n'}-${line.newLine ?? 'n'}`}
              className={
                line.kind === 'added'
                  ? 'bg-emerald-50 text-emerald-900'
                  : 'bg-rose-50 text-rose-900'
              }
            >
              {line.kind === 'added' ? '+' : '-'} {line.text}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
