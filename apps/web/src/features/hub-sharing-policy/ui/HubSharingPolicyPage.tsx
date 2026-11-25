import { Alert } from '@akasha/ui/alert'
import { Skeleton } from '@akasha/ui/skeleton'
import { getRequestErrorMessage } from '@/shared/api/error'
import { isCloudHub } from '@/shared/config/runtime'
import { LanguageMenu, useMessages } from '@/shared/i18n'
import { useAdminSharingPolicy } from '../hooks/useAdminSharingPolicy'
import { messages } from '../messages'
import { HubSharingPolicyEditor } from './HubSharingPolicyEditor'

interface HubSharingPolicyPageProps {
  /** 要管理例外的作品 ID；页面不请求该作品的内容。 */
  artifactId: string
}

/** 管理员独立策略页：确认会话后分别操作 Hub 默认值与单作品例外。 */
export function HubSharingPolicyPage({ artifactId }: HubSharingPolicyPageProps) {
  const { t } = useMessages(messages)
  const { session, policy, save } = useAdminSharingPolicy(artifactId)
  const user = session.data?.user
  const returnTo = `/admin/sharing/${encodeURIComponent(artifactId)}`
  const loginPath = `/auth/login?next=${encodeURIComponent(returnTo)}`
  const retryPolicy = () => {
    void session.refetch()
    void policy.refetch()
  }

  const cloud = isCloudHub()

  return (
    <main className="flex min-h-dvh flex-col items-center gap-4 bg-canvas p-6 text-ink">
      <div className="flex w-full max-w-2xl items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">{t('分享策略')}</h1>
        <LanguageMenu />
      </div>
      <p dir="ltr" className="w-full max-w-2xl truncate font-mono text-xs text-ink-muted">
        {artifactId}
      </p>
      {!cloud && <Alert className="w-full max-w-2xl" tone="danger" title={t('策略不可用')} />}
      {cloud && session.isPending && (
        <div role="status" aria-label={t('正在读取登录状态')} className="w-full max-w-2xl">
          <Skeleton className="h-14 w-full" />
        </div>
      )}
      {session.isError && (
        <Alert
          className="w-full max-w-2xl"
          tone="danger"
          title={t('无法读取登录状态')}
          action={{ label: t('重试'), onClick: () => void session.refetch() }}
        />
      )}
      {session.isSuccess && !user && (
        <Alert
          className="w-full max-w-2xl"
          tone="danger"
          title={t('仅 Hub 管理员可用')}
          action={{ label: t('使用 GitHub 登录'), href: loginPath }}
        />
      )}
      {session.isSuccess && user && !user.admin && (
        <Alert
          className="w-full max-w-2xl"
          tone="danger"
          title={t('当前账号不是 Hub 管理员')}
          action={{ label: t('返回作品库'), href: '/' }}
        />
      )}
      {session.isSuccess && user?.admin && policy.isPending && (
        <div role="status" aria-label={t('正在读取策略')} className="w-full max-w-2xl">
          <Skeleton className="h-56 w-full" />
        </div>
      )}
      {session.isSuccess && user?.admin && policy.isError && (
        <Alert
          className="w-full max-w-2xl"
          tone="danger"
          title={t('无法读取分享策略：{reason}', {
            reason: getRequestErrorMessage(policy.error),
          })}
          action={{ label: t('重试'), onClick: retryPolicy }}
        />
      )}
      {session.isSuccess && user?.admin && policy.isSuccess && policy.data && (
        <HubSharingPolicyEditor
          policy={policy.data}
          saving={save.isPending}
          error={save.error}
          onPatch={save.mutate}
        />
      )}
    </main>
  )
}
