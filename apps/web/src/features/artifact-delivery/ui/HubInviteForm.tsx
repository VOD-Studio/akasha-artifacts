import type { HubArtifactSharing, HubInviteInput, HubInviteTarget } from '@akasha/protocol'
import { Button } from '@akasha/ui/button'
import { Field } from '@akasha/ui/field'
import { Input } from '@akasha/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@akasha/ui/select'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { artifactKeys } from '@/entities/artifact'
import { getRequestErrorMessage } from '@/shared/api/error'
import { useMessages } from '@/shared/i18n'
import { createHubInvitation, type HubShareRole } from '../api/hubSharing'
import { messages } from '../owner-sharing.messages'

/** 有效期两档：一天与协议上限一周。 */
const TTL_SHORT = 24 * 60 * 60
const TTL_LONG = 7 * 24 * 60 * 60

interface HubInviteFormProps {
  artifactId: string
  organization: string | null
  /** Hub 的外发策略；停用外部邮箱时提示只接受已验证的成员邮箱。 */
  policy: HubArtifactSharing['policy']
}

/** 所有者创建定向邀请：点名成员、邮箱、组织或团队；创建后给出可复制的邀请地址。 */
export function HubInviteForm({ artifactId, organization, policy }: HubInviteFormProps) {
  const { t, date } = useMessages(messages)
  const client = useQueryClient()
  const [kind, setKind] = useState<HubInviteTarget['kind']>('member')
  const [login, setLogin] = useState('')
  const [email, setEmail] = useState('')
  const [slug, setSlug] = useState('')
  const [role, setRole] = useState<HubShareRole>('view')
  const [ttl, setTtl] = useState(TTL_SHORT)
  const [copying, setCopying] = useState(false)
  const [copied, setCopied] = useState(false)
  const invite = useMutation({
    mutationFn: (input: HubInviteInput) => createHubInvitation(artifactId, input),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: artifactKeys.sharing(artifactId) })
      if (kind === 'member') setLogin('')
      if (kind === 'email') setEmail('')
      if (kind === 'group') setSlug('')
      setCopied(false)
    },
  })
  const issued = invite.data

  // 组织配置在重取后可能消失；及时回到可用目标，避免提交旧的组织或团队目标。
  useEffect(() => {
    if ((kind === 'organization' || kind === 'group') && !organization) setKind('member')
  }, [kind, organization])

  const selectKind = (next: string) => {
    if (next !== 'member' && next !== 'email' && next !== 'organization' && next !== 'group') return
    setKind(next)
  }

  const selectRole = (next: string) => {
    if (next === 'view' || next === 'comment' || next === 'edit') setRole(next)
  }

  const selectTtl = (next: string) => {
    if (next === 'short') setTtl(TTL_SHORT)
    if (next === 'long') setTtl(TTL_LONG)
  }

  const orgTargetUnavailable = (kind === 'organization' || kind === 'group') && !organization

  const valueEmpty =
    orgTargetUnavailable ||
    (kind === 'member' && login.trim() === '') ||
    (kind === 'email' && email.trim() === '') ||
    (kind === 'group' && slug.trim() === '')

  const buildTarget = (): HubInviteInput['target'] | undefined => {
    if (orgTargetUnavailable) return undefined
    if (kind === 'organization') return { kind }
    if (kind === 'member' && login.trim()) return { kind, login: login.trim() }
    if (kind === 'email' && email.trim()) return { kind, email: email.trim() }
    if (kind === 'group' && slug.trim()) return { kind, slug: slug.trim() }
    return undefined
  }

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const target = buildTarget()
    if (!target || invite.isPending) return
    invite.mutate({ target, role, ttlSeconds: ttl })
  }

  const copyLink = async () => {
    if (!issued || copying) return
    setCopying(true)
    try {
      await navigator.clipboard.writeText(issued.url)
      setCopied(true)
    } catch {
      toast.info(t('请手动复制链接'))
    } finally {
      setCopying(false)
    }
  }

  return (
    <form className="space-y-3" onSubmit={submit}>
      <Field label={t('邀请对象')}>
        <Select value={kind} disabled={invite.isPending} onValueChange={selectKind}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="member">{t('点名成员')}</SelectItem>
            <SelectItem value="email">{t('邮箱地址')}</SelectItem>
            {organization ? (
              <SelectItem value="organization">{t('组织全体成员')}</SelectItem>
            ) : null}
            {organization ? <SelectItem value="group">{t('团队')}</SelectItem> : null}
          </SelectContent>
        </Select>
      </Field>
      {kind === 'member' && (
        <Field label={t('GitHub 用户名')}>
          <Input
            value={login}
            onChange={(event) => setLogin(event.currentTarget.value)}
            disabled={invite.isPending}
            autoComplete="off"
          />
        </Field>
      )}
      {kind === 'email' && (
        <Field
          label={t('邮箱')}
          hint={policy.externalEmail ? undefined : t('邮箱邀请仅接受已验证的 Hub 成员邮箱。')}
        >
          <Input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.currentTarget.value)}
            disabled={invite.isPending}
            autoComplete="off"
          />
        </Field>
      )}
      {kind === 'group' && (
        <Field label={t('团队标识')}>
          <Input
            value={slug}
            onChange={(event) => setSlug(event.currentTarget.value)}
            disabled={invite.isPending}
            autoComplete="off"
          />
        </Field>
      )}
      {kind === 'organization' && organization ? (
        <p className="text-xs text-ink-muted">
          {t('将按当前成员资格直接授权组织 {organization} 的成员。', { organization })}
        </p>
      ) : null}
      <Field label={t('被邀请者权限')}>
        <Select value={role} disabled={invite.isPending} onValueChange={selectRole}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="view">{t('仅查看')}</SelectItem>
            <SelectItem value="comment">{t('可批注')}</SelectItem>
            <SelectItem value="edit">{t('可编辑最新版本')}</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      <Field label={t('有效期')}>
        <Select
          value={ttl === TTL_LONG ? 'long' : 'short'}
          disabled={invite.isPending}
          onValueChange={selectTtl}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="short">{t('24 小时')}</SelectItem>
            <SelectItem value="long">{t('7 天')}</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      <Button type="submit" loading={invite.isPending} disabled={valueEmpty}>
        {t('邀请')}
      </Button>
      {invite.error ? (
        <p role="alert" className="text-sm text-error">
          {getRequestErrorMessage(invite.error)}
        </p>
      ) : null}
      {issued ? (
        <div className="space-y-2 rounded-md border border-border p-3">
          <Input
            type="url"
            dir="ltr"
            aria-label={t('邀请链接')}
            readOnly
            value={issued.url}
            onFocus={(event) => event.currentTarget.select()}
          />
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-ink-muted">
              {t('失效时间：{time}', {
                time: date(new Date(issued.expiresAt), {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                }),
              })}
            </p>
            <Button variant="outline" size="sm" loading={copying} onClick={() => void copyLink()}>
              {copied ? t('已复制') : t('复制链接')}
            </Button>
          </div>
        </div>
      ) : null}
      <p className="text-xs text-ink-muted">
        {t('成员与邮箱邀请在被接受后生效；组织与团队按当前成员资格直接生效。')}
      </p>
    </form>
  )
}
