import type { ArtifactHandoffReference } from '@akasha/protocol'
import { Button } from '@akasha/ui/button'
import { useMutation, useQuery } from '@tanstack/react-query'
import { getRequestErrorMessage } from '@/shared/api/error'
import { isCloudHub } from '@/shared/config/runtime'
import { useMessages } from '@/shared/i18n'
import { bindCodingTarget, listCodingTargets } from '../api/coding-sessions'
import { messages } from '../messages'

/** 用户在终端签入后才出现可选目标；界面不接受未验证的外部跳转地址。 */
export function CodingSessionTargets({ reference }: { reference: ArtifactHandoffReference }) {
  const { t } = useMessages(messages)
  const targets = useQuery({
    queryKey: ['coding-targets', reference],
    queryFn: ({ signal }) => listCodingTargets(reference, signal),
    retry: false,
    staleTime: 0,
    gcTime: 0,
  })
  const bind = useMutation({ mutationFn: (id: string) => bindCodingTarget(reference, id) })
  const error = bind.error ?? targets.error
  if (bind.data) {
    const { id, label } = bind.data
    return (
      <section className="space-y-2" aria-live="polite">
        <p>{t('已绑定：{label}', { label })}</p>
        <p className="text-sm text-ink-muted">
          {t('在已授权工程中续接，或为 Claude Code 配置此会话。')}
        </p>
        <pre
          dir="ltr"
          className="overflow-auto whitespace-pre-wrap break-all text-sm"
        >{`akasha coding read --session ${id}\nclaude mcp add --scope local --transport stdio akasha-${id.slice(0, 8)} -- akasha coding mcp --session ${id}`}</pre>
      </section>
    )
  }
  const commands = ['akasha coding connect']
  if (isCloudHub()) {
    const quote = (s: string) => `'${s.replaceAll("'", "'\\''")}'`
    const origin = quote(window.location.origin)
    commands[0] = `akasha login --hub ${origin}`
    commands.push(
      `akasha coding connect --hub ${origin} --project-id ${quote(reference.projectId)}`,
    )
  }
  return (
    <section className="space-y-2" aria-label={t('编码会话')}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">{t('编码会话')}</h3>
        <Button
          size="sm"
          variant="ghost"
          loading={targets.isFetching}
          disabled={bind.isPending}
          onClick={() => void targets.refetch()}
        >
          {t('刷新目标')}
        </Button>
      </div>
      {error && <p role="alert">{getRequestErrorMessage(error)}</p>}
      {!targets.isError && !targets.isPending && targets.data.length === 0 && (
        <>
          <p className="text-sm text-ink-muted">
            {t('暂无可用会话。在目标工程的终端运行以下命令，再刷新目标。')}
          </p>
          <pre dir="ltr" className="overflow-auto whitespace-pre-wrap break-all text-sm">
            {commands.join('\n')}
          </pre>
        </>
      )}
      {targets.data?.map((target) => (
        <Button
          key={target.id}
          size="sm"
          variant="outline"
          loading={bind.isPending && bind.variables === target.id}
          disabled={bind.isPending}
          onClick={() => bind.mutate(target.id)}
        >
          {target.bound
            ? t('续接 {label}', { label: target.label })
            : t('移交到 {label}', { label: target.label })}{' '}
          <bdi dir="ltr">{target.id.slice(0, 8)}</bdi>
        </Button>
      ))}
    </section>
  )
}
