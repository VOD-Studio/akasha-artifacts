import { Button } from '@akasha/ui/button'
import { useMutation, useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { clearAnnotationDrafts } from '@/entities/feedback'
import { hubSessionOptions } from '@/entities/hub-session'
import { isCloudHub } from '@/shared/config/runtime'
import { useMessages } from '@/shared/i18n'
import { endHubSession } from './api/session'
import { messages } from './messages'

/** 供界面在服务端授权之外隐藏只对 Hub 成员有意义的入口。 */
export function useHubSession() {
  const session = useQuery(hubSessionOptions())
  return session.isSuccess ? session.data.user : undefined
}

/** Hub 独占的账户入口；退出成功后清除上一个身份在本标签页的草稿。 */
export function HubAccountButton() {
  const { t } = useMessages(messages)
  const user = useHubSession()
  const logout = useMutation({
    mutationFn: endHubSession,
    onSuccess: () => {
      clearAnnotationDrafts()
      window.location.reload()
    },
    onError: (error) => {
      toast.error(error.message)
    },
  })
  if (!isCloudHub() || user === undefined) return null
  if (user) {
    return (
      <Button variant="ghost" size="sm" loading={logout.isPending} onClick={() => logout.mutate()}>
        {t('退出 @{login}', { login: user.login })}
      </Button>
    )
  }
  return (
    <Button asChild variant="ghost" size="sm">
      <a
        href={`/auth/login?next=${encodeURIComponent(window.location.pathname)}`}
        onClick={clearAnnotationDrafts}
      >
        {t('使用 GitHub 登录')}
      </a>
    </Button>
  )
}
