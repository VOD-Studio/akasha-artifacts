import { Badge } from '@akasha/ui/badge'
import { Button } from '@akasha/ui/button'
import { AlertTriangle, Check, ChevronDown, ChevronRight, Wrench, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { type SandboxErrorRecord, useWorkspaceStore } from '../../entities/workspace/store'
import { submitArtifactFeedback } from '../../shared/api/client'

export interface SourceSnippetLine {
  lineNo: number
  text: string
  isTarget: boolean
}

export function buildErrorFingerprint(
  artifactId: string,
  version: number,
  error: SandboxErrorRecord,
): string {
  return `${artifactId}:v${version}:${error.phase}:${error.loc ?? ''}:${error.message}`
}

export function parseLocLine(loc?: string): number | null {
  if (!loc) return null
  const m = /^(\d+):(\d+)/.exec(loc)
  if (!m?.[1]) return null
  const line = Number.parseInt(m[1], 10)
  return Number.isInteger(line) && line >= 1 ? line : null
}

// 从源码中截取报错行及其前后上下文，供错误面板高亮展示并随 runtime_error 反馈回传 Agent。
export function extractSourceSnippet(
  source: string,
  loc?: string,
  radius = 3,
): SourceSnippetLine[] {
  const targetLine = parseLocLine(loc)
  if (!targetLine || !source) return []
  const allLines = source.split('\n')
  if (targetLine > allLines.length) return []
  const start = Math.max(1, targetLine - radius)
  const end = Math.min(allLines.length, targetLine + radius)
  const out: SourceSnippetLine[] = []
  for (let lineNo = start; lineNo <= end; lineNo++) {
    out.push({
      lineNo,
      text: allLines[lineNo - 1] ?? '',
      isTarget: lineNo === targetLine,
    })
  }
  return out
}

export interface RuntimeErrorPanelProps {
  artifactId: string
  projectId: string
  version: number
  source: string
  error: SandboxErrorRecord
  onDismiss: () => void
  onSubmitFeedback?: typeof submitArtifactFeedback
}

// 运行时/编译错误恢复面板：高亮出错源码片段，支持一键提交 kind=runtime_error 给 Agent，并对同一错误去重避免刷屏。
export function RuntimeErrorPanel({
  artifactId,
  projectId,
  version,
  source,
  error,
  onDismiss,
  onSubmitFeedback = submitArtifactFeedback,
}: RuntimeErrorPanelProps) {
  const [submitting, setSubmitting] = useState(false)
  const [showStack, setShowStack] = useState(false)

  const fingerprint = useMemo(
    () => buildErrorFingerprint(artifactId, version, error),
    [artifactId, version, error],
  )
  const alreadySent = useWorkspaceStore((s) => Boolean(s.sentErrorFingerprints[fingerprint]))
  const markErrorSent = useWorkspaceStore((s) => s.markErrorSent)

  // 仅当错误阶段为 compile（由原始源码解析器产出准确行列号）时才按 loc 截取并归因原始源码片段；
  // 未经 sourcemap 映射的运行时异常省略原始行高亮，避免把编译后坐标误标到无关 TSX 行。
  const attributedLoc =
    error.phase === 'compile' && error.loc && /^\d+:\d+(?:-\d+:\d+)?$/.test(error.loc)
      ? error.loc
      : undefined
  const snippet = useMemo(
    () => (attributedLoc ? extractSourceSnippet(source, attributedLoc, 3) : []),
    [source, attributedLoc],
  )

  const handleSendToAgent = async () => {
    if (alreadySent || submitting) return
    setSubmitting(true)
    try {
      const snippetText =
        snippet.length > 0
          ? `\n\n出错源码片段：\n${snippet
              .map((l) => `${l.isTarget ? '>' : ' '} ${l.lineNo} | ${l.text}`)
              .join('\n')}`
          : ''
      const stackText = error.stack ? `\n\n调用栈：\n${error.stack.slice(0, 1200)}` : ''
      const body = `[${error.phase}] ${error.message}${attributedLoc ? ` (at ${attributedLoc})` : ''}${snippetText}${stackText}`

      await onSubmitFeedback(artifactId, {
        project: projectId,
        version,
        kind: 'runtime_error',
        element: attributedLoc
          ? { loc: attributedLoc, textPreview: error.message.slice(0, 200) }
          : { textPreview: error.message.slice(0, 200) },
        body,
      })
      markErrorSent(fingerprint)
      toast.success('已将该异常与源码位置提交给 Agent 修复')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '提交异常反馈失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      role="alert"
      data-testid="runtime-error-panel"
      className="rounded-xl border border-red-200 bg-red-50/90 p-3 text-xs text-red-950"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-start gap-2">
          <AlertTriangle size={15} className="mt-0.5 shrink-0 text-red-600" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">
                沙盒{error.phase === 'compile' ? '编译' : '运行时'}异常
              </span>
              {attributedLoc ? <Badge tone="danger">行:列 {attributedLoc}</Badge> : null}
              <Badge tone="neutral">v{version}</Badge>
            </div>
            <p className="mt-1 break-words font-mono text-xs text-red-900">{error.message}</p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {alreadySent ? (
            <Badge tone="ok" icon={<Check size={12} />}>
              已交给 Agent 修复
            </Badge>
          ) : (
            <Button
              variant="primary"
              size="sm"
              leftIcon={<Wrench size={13} />}
              loading={submitting}
              onClick={() => void handleSendToAgent()}
            >
              交给 Agent 修复
            </Button>
          )}
          <button
            type="button"
            aria-label="关闭错误面板"
            onClick={onDismiss}
            className="rounded p-1 text-red-700 hover:bg-red-100"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {snippet.length > 0 ? (
        <div className="mt-2.5 overflow-x-auto rounded-lg border border-red-200/80 bg-white font-mono text-[11px] leading-5">
          {snippet.map((line) => (
            <div
              key={line.lineNo}
              data-error-line={line.isTarget ? 'true' : undefined}
              className={`flex px-2.5 ${
                line.isTarget ? 'bg-red-100/90 font-semibold text-red-950' : 'text-slate-700'
              }`}
            >
              <span className="w-8 shrink-0 select-none text-right text-slate-400">
                {line.lineNo}
              </span>
              <span className="w-4 shrink-0 select-none text-center text-red-600">
                {line.isTarget ? '>' : ''}
              </span>
              <span className="whitespace-pre">{line.text}</span>
            </div>
          ))}
        </div>
      ) : null}

      {error.stack ? (
        <div className="mt-2">
          <button
            type="button"
            onClick={() => setShowStack((v) => !v)}
            className="inline-flex items-center gap-1 text-[11px] font-medium text-red-700 hover:underline"
          >
            {showStack ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            {showStack ? '收起调用栈' : '查看调用栈'}
          </button>
          {showStack ? (
            <pre className="mt-1 max-h-36 overflow-auto rounded-lg bg-red-950/95 p-2.5 font-mono text-[11px] text-red-100">
              {error.stack}
            </pre>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
