import type { AgentConversationTurn, ArtifactHandoffReference } from '@akasha/protocol'
import { Link } from '@tanstack/react-router'

export function describeAgentTarget(target: ArtifactHandoffReference) {
  const object = target.element?.blockId ?? target.element?.selector ?? target.element?.loc
  return [
    `固定 v${target.version}`,
    target.boardId ? `画板 ${target.boardId}` : undefined,
    object ? `对象 ${object}` : undefined,
  ]
    .filter(Boolean)
    .join(' · ')
}

/** 回执只来自同一轮的服务端记录；没有助手文字时不替它补一条回复。 */
export function AgentTurnList({ turns }: { turns: readonly AgentConversationTurn[] }) {
  return (
    <ol className="space-y-4" role="log" aria-label="Agent 会话记录">
      {turns.map((turn) => (
        <li key={turn.id} className="space-y-2 border-b border-border pb-4 last:border-0">
          <div className="rounded-md bg-surface-subtle px-3 py-2">
            <p className="text-xs font-semibold text-ink-muted">你</p>
            <p className="wrap-break-word whitespace-pre-wrap">{turn.message}</p>
            {turn.target ? (
              <p className="mt-1 wrap-break-word text-xs text-ink-muted">
                {describeAgentTarget(turn.target)}
              </p>
            ) : null}
          </div>
          {turn.reply ? (
            <div className="px-3 py-1">
              <p className="text-xs font-semibold text-ink-muted">Codex 回复</p>
              <p className="wrap-break-word whitespace-pre-wrap">{turn.reply}</p>
            </div>
          ) : null}
          {turn.publications.length ? (
            <ul className="space-y-1 px-3 text-xs" aria-label="此轮发布的版本">
              {turn.publications.map(({ artifactId, version }) => (
                <li key={`${artifactId}:${version}`}>
                  <Link
                    to="/a/$publicId/v/$version"
                    params={{ publicId: artifactId, version: String(version) }}
                    className="font-medium text-primary underline underline-offset-2"
                  >
                    已发布 v{version}
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
          {turn.status === 'running' ? (
            <p className="px-3 text-xs text-ink-muted">处理中…</p>
          ) : null}
          {turn.status === 'failed' ? (
            <p className="px-3 text-sm text-ink" role="alert">
              {turn.error ?? '处理失败'}
            </p>
          ) : null}
          {turn.status === 'complete' && !turn.publications.length ? (
            <p className="px-3 text-xs text-ink-muted">未发布新版本</p>
          ) : null}
        </li>
      ))}
    </ol>
  )
}
