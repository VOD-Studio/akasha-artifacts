import { Button } from '@akasha/ui/button'
import { Skeleton } from '@akasha/ui/skeleton'
import { useMutation, useQuery } from '@tanstack/react-query'
import { hubSessionOptions } from '@/entities/hub-session'
import { ApiError, getRequestErrorMessage, isResourceUnavailable } from '@/shared/api/error'
import { isCloudHub } from '@/shared/config/runtime'
import { LanguageMenu, useMessages } from '@/shared/i18n'
import { acceptInvitation } from '../api/invitations'
import { HubAccountButton } from '../HubActions'
import { messages } from '../messages'
import { clearHubDrafts } from '../model/clearHubDrafts'

interface HubInvitationPageProps {
  invitationId: string
  /** 只在服务端确认当前身份后进入作品。 */
  onAccepted: (artifactId: string) => void
}

/** 邀请未接受前不请求作品、授权对象或作者资料。 */
export function HubInvitationPage({ invitationId, onAccepted }: HubInvitationPageProps) {
  const { t } = useMessages(messages)
  const session = useQuery({
    ...hubSessionOptions(),
    refetchOnMount: 'always',
    refetchOnWindowFocus: 'always',
  })
  const acceptance = useMutation({ mutationFn: acceptInvitation })
  const needsLogin =
    session.data?.user === null ||
    (acceptance.error instanceof ApiError && acceptance.error.status === 401)
  const unavailable = !isCloudHub() || (!needsLogin && isResourceUnavailable(acceptance.error))
  const loginPath = `/auth/login?next=${encodeURIComponent(`/invite/${encodeURIComponent(invitationId)}`)}`
  const accept = () =>
    acceptance.mutate(invitationId, {
      onSuccess: ({ artifactId }) => onAccepted(artifactId),
    })
  const showActions = !unavailable && session.isSuccess

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-canvas p-6 text-ink">
      <div className="flex w-full max-w-md items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">{t('设计协作邀请')}</h1>
        <LanguageMenu />
      </div>
      <section className="flex w-full max-w-md flex-col items-start gap-3 rounded-xl border border-border bg-surface p-4">
        {unavailable && <p role="alert">{t('邀请不可用')}</p>}
        {unavailable && session.data?.user && <HubAccountButton />}
        {!unavailable && session.isPending && (
          <div role="status" aria-label={t('正在读取登录状态')} className="w-full">
            <Skeleton className="h-8 w-36" />
          </div>
        )}
        {!unavailable && session.isError && (
          <>
            <p role="alert">{t('无法读取登录状态')}</p>
            <Button size="sm" loading={session.isFetching} onClick={() => void session.refetch()}>
              {t('重试')}
            </Button>
          </>
        )}
        {showActions && needsLogin && (
          <Button asChild size="sm">
            <a href={loginPath} onClick={clearHubDrafts}>
              {t('使用 GitHub 登录')}
            </a>
          </Button>
        )}
        {showActions && !needsLogin && session.data?.user && (
          <>
            {acceptance.isError && <p role="alert">{getRequestErrorMessage(acceptance.error)}</p>}
            <Button
              size="sm"
              disabled={session.isFetching}
              loading={acceptance.isPending}
              onClick={accept}
            >
              {t('以 @{login} 接受邀请', { login: session.data.user.login })}
            </Button>
          </>
        )}
      </section>
    </main>
  )
}
