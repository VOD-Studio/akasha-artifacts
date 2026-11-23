import { Button } from '@akasha/ui/button'
import { useMutation, useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { clearAnnotationDrafts } from '../../entities/feedback/annotation-draft'
import { isCloudHub } from '../../shared/config/runtime'

function useHubSession() {
  return useQuery({
    queryKey: ['hub-session'],
    enabled: isCloudHub(),
    staleTime: 60_000,
    async queryFn() {
      const response = await fetch('/api/v1/auth/session', { credentials: 'same-origin' })
      if (!response.ok) throw new Error('读取 Hub 登录状态失败')
      return (await response.json()) as { user: { login: string; member: boolean } | null }
    },
  }).data?.user
}

export function HubAccountButton() {
  const user = useHubSession()
  const logout = useMutation({
    async mutationFn() {
      const response = await fetch('/api/v1/auth/logout', {
        method: 'POST',
        credentials: 'same-origin',
      })
      if (!response.ok) throw new Error('退出 Hub 失败')
    },
    onSuccess() {
      clearAnnotationDrafts()
      window.location.reload()
    },
    onError(error) {
      toast.error(error.message)
    },
  })
  if (!isCloudHub()) return null
  if (user) {
    return (
      <Button variant="ghost" size="sm" loading={logout.isPending} onClick={() => logout.mutate()}>
        退出 @{user.login}
      </Button>
    )
  }
  return (
    <a
      href={`/auth/login?next=${encodeURIComponent(window.location.pathname)}`}
      onClick={clearAnnotationDrafts}
      className="rounded px-2.5 py-1.5 text-sm font-medium text-ink hover:bg-muted"
    >
      GitHub 登录
    </a>
  )
}
