import type { AgentConversationTurn, ArtifactHandoffReference } from '@akasha/protocol'
import { Link } from '@tanstack/react-router'
import { useMessages } from '@/shared/i18n'
import { messages } from '../messages'

export function AgentTarget({ target }: { target: ArtifactHandoffReference }) {
  const { t } = useMessages(messages)
  const object = target.element?.blockId ?? target.element?.selector ?? target.element?.loc
  return [
    t('固定 {version}', { version: `v${target.version}` }),
    target.boardId ? t('画板 {id}', { id: target.boardId }) : undefined,
    object ? t('对象 {id}', { id: object }) : undefined,
  ]
    .filter(Boolean)
    .join(' · ')
}

/** 回执只来自同一轮的服务端记录；没有助手文字时不替它补一条回复。 */
export function AgentTurnList({ turns }: { turns: readonly AgentConversationTurn[] }) {
  const { t } = useMessages(messages)
  return (
    <ol className="space-y-4" role="log" aria-label={t('Agent 会话记录')}>
      {turns.map((turn) => (
        <li key={turn.id} className="space-y-2 border-b border-border pb-4 last:border-0">
          <div className="rounded-md bg-surface-subtle px-3 py-2">
            <p className="text-xs font-semibold text-ink-muted">{t('你')}</p>
            <p dir="auto" className="wrap-break-word whitespace-pre-wrap">
              {turn.message}
            </p>
            {turn.target ? (
              <p className="mt-1 wrap-break-word text-xs text-ink-muted">
                <AgentTarget target={turn.target} />
              </p>
            ) : null}
          </div>
          {turn.reply ? (
            <div className="px-3 py-1">
              <p className="text-xs font-semibold text-ink-muted">{t('Codex 回复')}</p>
              <p dir="auto" className="wrap-break-word whitespace-pre-wrap">
                {turn.reply}
              </p>
            </div>
          ) : null}
          {turn.publications.length ? (
            <ul className="space-y-1 px-3 text-xs" aria-label={t('此轮发布的版本')}>
              {turn.publications.map(({ artifactId, version }) => (
                <li key={`${artifactId}:${version}`}>
                  <Link
                    to="/a/$publicId/v/$version"
                    params={{ publicId: artifactId, version: String(version) }}
                    className="font-medium text-primary underline underline-offset-2"
                  >
                    {t('已发布 {version}', { version: `v${version}` })}
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
          {turn.status === 'running' ? (
            <p className="px-3 text-xs text-ink-muted">{t('处理中…')}</p>
          ) : null}
          {turn.status === 'failed' ? (
            <p className="px-3 text-sm text-ink" role="alert">
              {turn.error ? <bdi>{turn.error}</bdi> : t('处理失败')}
            </p>
          ) : null}
          {turn.status === 'complete' && !turn.publications.length ? (
            <p className="px-3 text-xs text-ink-muted">{t('未发布新版本')}</p>
          ) : null}
        </li>
      ))}
    </ol>
  )
}
