import { canGrantShareRole, type HubGrantSummary } from '@akasha/protocol'
import { Button } from '@akasha/ui/button'
import { Empty } from '@akasha/ui/empty'
import { Input } from '@akasha/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@akasha/ui/select'
import { type ReactNode, useState } from 'react'
import { toast } from 'sonner'
import { useMessages } from '@/shared/i18n'
import type { HubShareRole } from '../api/hubSharing'
import { messages } from '../owner-sharing.messages'

interface HubShareGrantsProps {
  grants: readonly HubGrantSummary[]
  /** Hub 配置的组织名，用于组织授权的展示；未配置时回退为泛称。 */
  organization: string | null
  /** 正在调整角色或撤回的授权行；该行控件暂时不可用。 */
  pendingGrantId: string | null
  /** 行级操作失败后的提示；无操作或成功时为空。 */
  error?: ReactNode
  onRoleChange: (grantId: string, role: HubShareRole) => void
  /** 撤回前由调用方确认；`target` 为本行已本地化的展示名。 */
  onRevoke: (grant: HubGrantSummary, target: string) => void
}

/** 既有授权的邀请地址与新建邀请同源同形；列表不重构已签发的普通链接。 */
const inviteAddress = (grantId: string) =>
  `${window.location.origin}/invite/${encodeURIComponent(grantId)}`

/** 所有者的授权列表：每行可调整角色、复制邀请地址或撤回；普通链接不提供复制。 */
export function HubShareGrants({
  grants,
  organization,
  pendingGrantId,
  error,
  onRoleChange,
  onRevoke,
}: HubShareGrantsProps) {
  const { t, date } = useMessages(messages)
  const [copyingId, setCopyingId] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [manualId, setManualId] = useState<string | null>(null)

  const copyInvite = async (grant: HubGrantSummary) => {
    if (grant.target.kind === 'link' || copyingId) return
    setCopyingId(grant.id)
    setCopiedId(null)
    setManualId(null)
    try {
      await navigator.clipboard.writeText(inviteAddress(grant.id))
      setCopiedId(grant.id)
    } catch {
      setManualId(grant.id)
      toast.info(t('请手动复制链接'))
    } finally {
      setCopyingId(null)
    }
  }

  const targetLabel = (grant: HubGrantSummary): string => {
    const target = grant.target
    switch (target.kind) {
      case 'link':
        return t('普通链接')
      case 'member':
        return t('成员 @{login}', { login: target.login })
      case 'email':
        return t('邮箱 {email}', { email: target.email })
      case 'group':
        return t('团队 {slug}', { slug: target.slug })
      case 'organization':
        return organization ? t('组织 {organization} 成员', { organization }) : t('组织全体成员')
    }
  }

  const selectRole = (grantId: string, next: string) => {
    if (next === 'view' || next === 'comment' || next === 'edit') onRoleChange(grantId, next)
  }

  return (
    <section className="space-y-2">
      <h3 className="text-sm font-medium">{t('当前授权')}</h3>
      {error ? (
        <p role="alert" className="text-sm text-error">
          {error}
        </p>
      ) : null}
      {grants.length === 0 ? (
        <Empty
          variant="plain"
          title={t('还没有授权')}
          description={t('在下方邀请指定的人访问。')}
        />
      ) : (
        <ul className="-mx-1 max-h-72 divide-y divide-border overflow-y-auto px-1">
          {grants.map((grant) => {
            const target = targetLabel(grant)
            const pending = pendingGrantId === grant.id
            const named = grant.target.kind === 'member' || grant.target.kind === 'email'
            return (
              <li
                key={grant.id}
                className="flex flex-wrap items-center justify-between gap-3 py-2.5"
              >
                <div className="min-w-0 text-sm">
                  <p dir="auto" className="wrap-break-word font-medium">
                    {target}
                  </p>
                  <p className="text-xs text-ink-muted">
                    {named ? <span>{grant.accepted ? t('已接受') : t('待接受')}</span> : null}
                    {named ? ' · ' : null}
                    <time dateTime={grant.expiresAt}>
                      <bdi>
                        {t('失效时间：{time}', {
                          time: date(new Date(grant.expiresAt), {
                            dateStyle: 'medium',
                            timeStyle: 'short',
                          }),
                        })}
                      </bdi>
                    </time>
                  </p>
                </div>
                <div className="flex max-w-full flex-wrap items-center gap-2">
                  <Select
                    value={grant.role}
                    disabled={pending}
                    onValueChange={(next) => selectRole(grant.id, next)}
                  >
                    <SelectTrigger controlSize="sm" aria-label={t('{target} 的权限', { target })}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="view">{t('仅查看')}</SelectItem>
                      <SelectItem value="comment">{t('可批注')}</SelectItem>
                      {canGrantShareRole(grant.entry, 'edit') && (
                        <SelectItem value="edit">{t('可编辑最新版本')}</SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                  {grant.target.kind !== 'link' ? (
                    <Button
                      variant="outline"
                      size="sm"
                      loading={copyingId === grant.id}
                      done={copiedId === grant.id ? t('已复制') : undefined}
                      disabled={pending}
                      aria-label={t('复制邀请 {target}', { target })}
                      onClick={() => void copyInvite(grant)}
                    >
                      {t('复制邀请')}
                    </Button>
                  ) : null}
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={pending}
                    aria-label={t('撤回 {target}', { target })}
                    onClick={() => onRevoke(grant, target)}
                  >
                    {t('撤回')}
                  </Button>
                </div>
                {manualId === grant.id && (
                  <Input
                    type="url"
                    dir="ltr"
                    aria-label={t('邀请链接')}
                    readOnly
                    value={inviteAddress(grant.id)}
                    onFocus={(event) => event.currentTarget.select()}
                  />
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
