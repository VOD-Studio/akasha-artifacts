import { Badge } from '@akasha/ui/badge'
import { Button } from '@akasha/ui/button'
import { AlertTriangle, Check, ChevronDown, ChevronRight, Wrench, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { submitArtifactFeedback } from '../../entities/feedback'
import { type SandboxErrorRecord, useWorkspaceStore } from '../../entities/workspace/store'

/** 错误面板里展示的一行源码；`isTarget` 标出出错的那一行。 */
export interface SourceSnippetLine {
  lineNo: number
  text: string
  isTarget: boolean
}

/** 给一条沙盒错误生成指纹，用来判断同一条错误是否已经交给 Agent。 */
export function buildErrorFingerprint(
  artifactId: string,
  version: number,
  error: SandboxErrorRecord,
): string {
  return `${artifactId}:v${version}:${error.phase}:${error.loc ?? ''}:${error.message}`
}

/** 从 `line:col` 形式的源码位置里取出行号；无法解析时返回 `null`。 */
export function parseLocLine(loc?: string): number | null {
  if (!loc) return null
  const m = /^(\d+):(\d+)/.exec(loc)
  if (!m?.[1]) return null
  const line = Number.parseInt(m[1], 10)
  return Number.isInteger(line) && line >= 1 ? line : null
}

/**
 * 从源码中截取出错行及其前后各 `radius` 行。
 *
 * @returns `loc` 无法解析或超出源码行数时返回空数组。
 */
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

/**
 * 运行时或编译错误的恢复面板：高亮出错的源码片段，可一键把 `kind=runtime_error` 的反馈交给 Agent。
 *
 * @remarks 同一条错误只提交一次，避免刷屏。
 */
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
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '发送失败')
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
                {error.phase === 'compile' ? '无法加载预览' : '预览出错'}
              </span>
              {attributedLoc ? <Badge tone="danger">源码 {attributedLoc}</Badge> : null}
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
          <Button variant="ghost" size="sm" iconOnly aria-label="关闭错误面板" onClick={onDismiss}>
            <X size={14} aria-hidden />
          </Button>
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
          <Button
            variant="ghost"
            size="sm"
            aria-expanded={showStack}
            onClick={() => setShowStack((v) => !v)}
            leftIcon={showStack ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          >
            {showStack ? '收起详情' : '查看详情'}
          </Button>
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
