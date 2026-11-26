import { type AnnotationThread, type Feedback, isAnnotationKind } from '@akasha/protocol'
import { Badge } from '@akasha/ui/badge'
import { Button } from '@akasha/ui/button'
import { ArrowUpRight, Target } from 'lucide-react'
import type { MouseEvent, Ref } from 'react'
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
  onOpenVersion?: (version: number, hash: string) => void
}

type StatusTone = 'warning' | 'accent' | 'ok' | 'neutral' | 'danger'

function feedbackStatusBadge(
  fb: Feedback,
  thread?: AnnotationThread,
): {
  label: keyof typeof panelMessages
  tone: StatusTone
} {
  if (fb.draft) return { label: '草稿', tone: 'warning' }
  if (fb.audience === 'human') return { label: '仅讨论', tone: 'neutral' }
  const agent = thread?.agent
  if (agent) {
    switch (agent.state) {
      case 'queued':
        return { label: '排队中', tone: 'warning' }
      case 'running':
        return { label: 'Agent 处理中', tone: 'accent' }
      case 'failed':
        return { label: '执行失败', tone: 'danger' }
      case 'replied':
        return { label: '已回复 · 无新版本', tone: 'neutral' }
      case 'published':
        return { label: '已发布新版本', tone: 'ok' }
    }
  }
  if (fb.status === 'resolved') {
    return { label: isAnnotationKind(fb.kind) ? 'Agent 已处理' : '已解决', tone: 'ok' }
  }
  if (fb.status === 'delivered') return { label: '已收件（尚无回复）', tone: 'accent' }
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

function buildThreadHash(fb: Feedback, locatePublished: boolean): string {
  const params = new URLSearchParams()
  if (fb.element?.boardId) params.set('board', fb.element.boardId)
  params.set('thread', fb.id)
  if (locatePublished && fb.element) params.set('locate', '1')
  return params.toString()
}

function isPlainLeftClick(event: MouseEvent<HTMLAnchorElement>): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey
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
  onOpenVersion,
}: InspectorFeedbackCardProps) {
  const { t, locale, date } = useMessages(panelMessages)
  const statusMeta = feedbackStatusBadge(fb, thread)
  const isOldVersion = fb.version !== activeVersion
  const points = fb.element?.dataPoints
  const locator = feedbackLocator(fb.element, t)
  const boardId = fb.element?.boardId
  const agent = thread?.agent
  const isDraftForAgent = fb.draft && (fb.audience === 'agent' || fb.kind === 'request_changes')
  const isReceiptOnly = !fb.draft && fb.audience !== 'human' && !agent && fb.status === 'delivered'
  const originHash = buildThreadHash(fb, false)
  const originHref = `/a/${encodeURIComponent(artifactId)}/v/${fb.version}${window.location.search}#${originHash}`

  return (
    <div
      ref={isFocused ? focusedCard : undefined}
      aria-current={isFocused || undefined}
      data-testid={`feedback-item-${fb.id}`}
      className={`rounded-12 border p-3 text-xs transition-colors ${
        fb.draft ? 'border-dashed border-warning/45 bg-warning/10' : 'border-border bg-surface'
      } ${isFocused ? 'ring-2 ring-ring' : ''}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-1.5">
        <div className="flex flex-wrap items-center gap-1.5">
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
          href={originHref}
          onClick={(event) => {
            if (!onOpenVersion || !isPlainLeftClick(event)) return
            event.preventDefault()
            onOpenVersion(fb.version, originHash)
          }}
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

      {isDraftForAgent ? (
        <p className="mt-1.5 text-[11px] text-ink-muted">{t('提交本轮后发给 Agent')}</p>
      ) : null}

      {isReceiptOnly ? (
        <p
          data-testid={`feedback-agent-${fb.id}`}
          className="mt-2 rounded-lg border border-border bg-surface-subtle px-2 py-1.5 text-[11px] text-ink-muted"
        >
          {t('仅收到 Agent 收件回执，尚未返回正文回复。')}
        </p>
      ) : null}

      {agent ? (
        <section
          aria-label={t('Agent 回复')}
          data-testid={`feedback-agent-${fb.id}`}
          data-agent-state={agent.state}
          className="mt-2 space-y-1.5 rounded-lg border border-border bg-surface-subtle px-2.5 py-2"
        >
          {agent.state === 'queued' ? (
            <p className="text-[11px] text-ink-muted" role="status">
              {t('Agent 正忙，已排队等待上一轮完成后执行。')}
            </p>
          ) : null}
          {agent.state === 'running' ? (
            <p className="text-[11px] text-ink-muted" role="status">
              {t('已送达已绑定 Agent，正在处理…')}
            </p>
          ) : null}
          {agent.reply ? (
            <div className="space-y-0.5">
              <p className="text-[11px] font-semibold text-ink-muted">{t('Agent 回复')}</p>
              <p
                dir="auto"
                className="whitespace-pre-wrap break-words text-xs leading-relaxed text-ink"
              >
                {agent.reply}
              </p>
            </div>
          ) : null}
          {agent.state === 'replied' ? (
            <p className="text-[11px] text-ink-muted">{t('本轮仅回复，未发布新版本。')}</p>
          ) : null}
          {agent.publications.length > 0 ? (
            <ul className="flex flex-wrap gap-1.5 pt-0.5">
              {agent.publications.map((pub) => {
                const pubHash = buildThreadHash(fb, true)
                const pubHref = `/a/${encodeURIComponent(pub.artifactId)}/v/${pub.version}${window.location.search}#${pubHash}`
                const label = fb.element
                  ? t('在 {version} 查看该对象', { version: `v${pub.version}` })
                  : t('打开 {version}', { version: `v${pub.version}` })
                return (
                  <li key={`${pub.artifactId}:${pub.version}`}>
                    <a
                      href={pubHref}
                      className="inline-flex items-center gap-1 rounded-md border border-border bg-surface px-2 py-0.5 text-[11px] font-medium text-primary hover:underline"
                      onClick={(event) => {
                        if (
                          !onOpenVersion ||
                          pub.artifactId !== artifactId ||
                          !isPlainLeftClick(event)
                        )
                          return
                        event.preventDefault()
                        onOpenVersion(pub.version, pubHash)
                      }}
                    >
                      <span>{label}</span>
                      <ArrowUpRight size={11} aria-hidden="true" />
                    </a>
                  </li>
                )
              })}
            </ul>
          ) : null}
          {agent.state === 'failed' ? (
            <p role="alert" className="text-[11px] text-destructive">
              {agent.error ? <bdi>{agent.error}</bdi> : t('执行失败')}
            </p>
          ) : null}
        </section>
      ) : null}

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
