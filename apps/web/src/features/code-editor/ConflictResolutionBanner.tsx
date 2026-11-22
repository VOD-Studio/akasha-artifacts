import { Badge } from '@akasha/ui/badge'
import { Button } from '@akasha/ui/button'
import { AlertTriangle, Check, RefreshCw } from 'lucide-react'
import { useMemo } from 'react'
import { computeLineDiff } from '../../shared/lib/diff'

export interface EditorConflictState {
  reason: 'http_409' | 'remote_updated'
  baseVersion: number
  headVersion: number
  authors: string[]
  serverDiff?: string
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

// 并发版本冲突横幅：展示落后基线与最新远端版本的作者与逐行差异，支持加载最新或基于最新基线合并保存。
export function ConflictResolutionBanner({
  conflict,
  saving = false,
  onAdoptLatest,
  onSaveMerged,
  onDismiss,
}: ConflictResolutionBannerProps) {
  const computedLines = useMemo(() => {
    if (conflict.remoteSource === undefined) return []
    return computeLineDiff(conflict.remoteSource, conflict.localSource).filter(
      (line) => line.kind !== 'context',
    )
  }, [conflict.remoteSource, conflict.localSource])

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
          <span className="font-semibold">
            {conflict.reason === 'http_409'
              ? `保存冲突（409）：远端已推进至 v${conflict.headVersion}`
              : `检测到并发更新：远端已推进至 v${conflict.headVersion}`}
          </span>
          <Badge tone="warning">
            你的基线 v{conflict.baseVersion} → 最新 v{conflict.headVersion}
          </Badge>
          <span className="text-[11px] text-amber-800">更新作者：{authorSummary}</span>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            variant="outline"
            size="sm"
            leftIcon={<RefreshCw size={12} />}
            disabled={saving}
            onClick={onAdoptLatest}
          >
            加载最新 v{conflict.headVersion}
          </Button>
          <Button
            variant="primary"
            size="sm"
            leftIcon={<Check size={12} />}
            loading={saving}
            onClick={onSaveMerged}
          >
            基于 v{conflict.headVersion} 合并保存
          </Button>
          {onDismiss ? (
            <Button variant="ghost" size="sm" onClick={onDismiss}>
              稍后处理
            </Button>
          ) : null}
        </div>
      </div>

      {conflict.serverDiff ? (
        <pre
          data-testid="conflict-server-diff"
          className="mt-2 max-h-36 overflow-auto rounded-lg border border-amber-200 bg-white/90 p-2 font-mono text-[11px] leading-5 text-slate-800"
        >
          {conflict.serverDiff}
        </pre>
      ) : computedLines.length > 0 ? (
        <div
          data-testid="conflict-computed-diff"
          className="mt-2 max-h-36 overflow-auto rounded-lg border border-amber-200 bg-white/90 p-2 font-mono text-[11px] leading-5"
        >
          <div className="mb-1 text-[10px] font-sans text-slate-500">
            差异对照（- 远端 v{conflict.headVersion} / + 你的当前编辑）
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
      ) : null}
    </div>
  )
}
