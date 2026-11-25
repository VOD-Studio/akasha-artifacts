import { type AnnotationThread, type Feedback, isAnnotationKind } from '@akasha/protocol'
import { Badge } from '@akasha/ui/badge'
import { Button } from '@akasha/ui/button'
import { Target } from 'lucide-react'
import type { Ref } from 'react'
import { useMessages } from '@/shared/i18n'
import { formatRelativeTime } from '@/shared/lib/format'
import { panelMessages } from '../messages'
import { AnnotationThreadActions } from './AnnotationThreadActions'

interface InspectorFeedbackCardProps {
  artifactId: string
  activeVersion: number
  feedback: Feedback
  thread?: AnnotationThread
  canComment: boolean
  isFocused: boolean
  focusedCard: Ref<HTMLDivElement>
  onFocusFeedback: (feedback: Feedback) => void
}

function feedbackStatusBadge(fb: Feedback): {
  label: keyof typeof panelMessages
  tone: 'warning' | 'accent' | 'ok' | 'neutral'
} {
  if (fb.draft) return { label: '草稿', tone: 'warning' }
  if (fb.audience === 'human') return { label: '仅讨论', tone: 'neutral' }
  if (fb.status === 'resolved')
    return { label: isAnnotationKind(fb.kind) ? 'Agent 已处理' : '已解决', tone: 'ok' }
  if (fb.status === 'delivered') return { label: '已送达', tone: 'accent' }
  return { label: '待处理', tone: 'neutral' }
}

function feedbackKindLabel(kind: Feedback['kind']): keyof typeof panelMessages {
  switch (kind) {
    case 'approve':
      return '批准'
    case 'request_changes':
      return '请求修改'
    case 'runtime_error':
      return '运行异常'
    case 'vote':
      return '方案选择'
    case 'pass':
      return 'Pass'
    case 'reject':
      return 'Reject'
    case 'waive':
      return 'Waive'
    case 'edit':
      return '直接修改'
    default:
      return '批注'
  }
}

function feedbackLocator(
  element: Feedback['element'],
  t: ReturnType<typeof useMessages<typeof panelMessages>>['t'],
): string | undefined {
  if (!element) return
  const { dataPoints, textPreview, blockId, loc, selector } = element
  if (dataPoints)
    return t('{title} · {count} 个数据点', {
      title: dataPoints.chartTitle,
      count: dataPoints.points.length,
    })
  if (textPreview) return textPreview
  if (blockId) return `#${blockId}`
  if (loc) return `@${loc}`
  return selector?.slice(0, 28)
}

export function InspectorFeedbackCard({
  artifactId,
  activeVersion,
  feedback: fb,
  thread,
  canComment,
  isFocused,
  focusedCard,
  onFocusFeedback,
}: InspectorFeedbackCardProps) {
  const { t, locale, date } = useMessages(panelMessages)
  const statusMeta = feedbackStatusBadge(fb)
  const isOldVersion = fb.version !== activeVersion
  const points = fb.element?.dataPoints
  const locator = feedbackLocator(fb.element, t)
  const boardId = fb.element?.boardId

  return (
    <div
      ref={isFocused ? focusedCard : undefined}
      aria-current={isFocused || undefined}
      data-testid={`feedback-item-${fb.id}`}
      className={`rounded-xl border p-2.5 text-xs transition ${
        fb.draft ? 'border-dashed border-amber-300 bg-amber-50/50' : 'border-border bg-surface'
      } ${isFocused ? 'ring-2 ring-ring' : ''}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-1.5">
        <div className="flex items-center gap-1.5">
          <Badge tone={statusMeta.tone}>{t(statusMeta.label)}</Badge>
          {thread?.resolution && <Badge tone="ok">{t('讨论已解决')}</Badge>}
          <span className="text-[11px] font-medium text-ink-muted">
            {t(feedbackKindLabel(fb.kind))}
          </span>
          {isOldVersion ? (
            <Badge tone="off" data-testid={`old-version-badge-${fb.id}`}>
              {t('针对 {version}', { version: `v${fb.version}` })}
            </Badge>
          ) : (
            <span className="text-[11px] text-ink-muted">v{fb.version}</span>
          )}
        </div>
        <span className="flex items-center gap-1.5 text-[10px] text-ink-muted">
          <bdi>{fb.author}</bdi>
          <time
            dir="ltr"
            dateTime={fb.createdAt}
            title={date(fb.createdAt, { dateStyle: 'medium', timeStyle: 'short' })}
          >
            {formatRelativeTime(fb.createdAt, undefined, locale)}
          </time>
        </span>
      </div>
      {isOldVersion && locator && (
        <p className="mt-1 truncate text-[11px] text-ink-muted">
          {boardId ? `${boardId} · ` : ''}
          {locator}
        </p>
      )}
      {isOldVersion && (
        <a
          className="mt-1.5 inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[11px] text-ink hover:underline"
          href={`/a/${encodeURIComponent(artifactId)}/v/${fb.version}${window.location.search}#thread=${encodeURIComponent(fb.id)}`}
        >
          <Target size={10} />
          {t('回 {version} 定位', { version: `v${fb.version}` })}
        </a>
      )}
      {!isOldVersion && locator && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onFocusFeedback(fb)}
          className="mt-1.5 max-w-full font-mono"
          leftIcon={<Target size={10} />}
        >
          <span className="sr-only">{t('定位：')}</span>
          <span className="truncate">
            {boardId ? `${boardId} · ` : ''}
            {locator}
          </span>
        </Button>
      )}
      {points && (
        <details className="mt-1 text-ink-muted">
          <summary className="cursor-pointer">{t('查看圈选数据')}</summary>
          <ul className="mt-1 space-y-1">
            {points.points.map((point) => (
              <li key={point.id}>
                {point.label}：{point.value} {points.valueLabel}
              </li>
            ))}
          </ul>
        </details>
      )}
      <p
        dir="auto"
        className="mt-1.5 whitespace-pre-wrap break-words text-xs leading-relaxed text-ink"
      >
        {fb.body}
      </p>
      {isAnnotationKind(fb.kind) && (
        <AnnotationThreadActions
          artifactId={artifactId}
          feedbackId={fb.id}
          thread={thread}
          readOnly={!canComment}
        />
      )}
    </div>
  )
}
