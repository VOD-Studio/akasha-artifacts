import type { CatalogSystem, SystemPublicationAction } from '@akasha/protocol'
import { Button } from '@akasha/ui/button'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { hubSessionOptions } from '@/entities/hub-session'
import { useMessages } from '@/shared/i18n'
import { catalogOptions, changePublication } from '../api/catalog'
import { messages } from '../messages'

interface PublicationTarget {
  projectId: string
  id: string
  version: number
}

const labels = {
  publish: '发布到团队',
  default: '设为默认',
  'clear-default': '撤销默认',
  withdraw: '撤回',
} as const satisfies Record<SystemPublicationAction, keyof typeof messages>

/** 操作返回后重新读取目录，不在客户端推定团队默认已切换。 */
export function PublicationControls({
  projectId,
  id,
  version,
  publication,
  isDefault,
}: PublicationTarget & Pick<CatalogSystem, 'publication' | 'isDefault'>) {
  const { t } = useMessages(messages)
  const cache = useQueryClient()
  const change = useMutation({
    mutationFn: (action: SystemPublicationAction) =>
      changePublication(projectId, id, version, action),
    onSuccess: () => cache.invalidateQueries({ queryKey: ['system-catalog'] }),
  })
  const button = (action: SystemPublicationAction) => (
    <Button
      size="sm"
      variant="outline"
      loading={change.isPending && change.variables === action}
      disabled={change.isPending}
      onClick={() => change.mutate(action)}
    >
      {t(labels[action])}
    </Button>
  )
  return (
    <div className="flex flex-wrap items-center gap-2">
      {publication === 'private' && button('publish')}
      {publication === 'team' && button(isDefault ? 'clear-default' : 'default')}
      {publication === 'team' && button('withdraw')}
      {change.isError && <p role="alert">{t('未能更新发布状态')}</p>}
    </div>
  )
}

function OwnerPublication(target: PublicationTarget) {
  const { t } = useMessages(messages)
  const catalog = useQuery(catalogOptions(target.projectId))
  if (catalog.isPending) return <p role="status">{t('正在读取')}</p>
  if (catalog.isError)
    return (
      <div role="alert">
        {t('无法读取系统目录')} <Button onClick={() => void catalog.refetch()}>{t('重试')}</Button>
      </div>
    )
  const item = catalog.data.items.find(
    (entry) => entry.id === target.id && entry.version === target.version,
  )
  return (
    <PublicationControls
      {...target}
      publication={item?.publication ?? 'private'}
      isDefault={item?.isDefault ?? false}
    />
  )
}

/** 所有者打开历史版本时，未列入目录的版本也可由当前管理员发布。 */
export function OwnerVersionPublication(target: PublicationTarget) {
  const session = useQuery(hubSessionOptions())
  if (!session.isSuccess || !session.data.user?.member || !session.data.user.admin) return null
  return <OwnerPublication {...target} />
}
