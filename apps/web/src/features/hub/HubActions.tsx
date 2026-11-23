import { Button } from '@akasha/ui/button'
import { Modal } from '@akasha/ui/dialog'
import { DropdownMenuItem } from '@akasha/ui/dropdown-menu'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Link2 } from 'lucide-react'
import { useState } from 'react'
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

export function HubShareMenuItem({
  publicId,
  onShare,
}: {
  publicId: string
  onShare: (link: string) => void
}) {
  const user = useHubSession()
  const share = useMutation({
    async mutationFn() {
      const response = await fetch(`/api/v1/artifacts/${encodeURIComponent(publicId)}/share`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
      if (!response.ok) throw new Error('只有制品所有者可以创建签名分享链接')
      return (await response.json()) as { url: string }
    },
    onSuccess: ({ url }) => onShare(url),
    onError: (error) => toast.error(error.message),
  })
  if (!user?.member) return null
  return (
    <DropdownMenuItem disabled={share.isPending} onSelect={() => share.mutate()}>
      <Link2 size={14} />
      创建分享链接
    </DropdownMenuItem>
  )
}

export function HubShareDialog({ link, onClose }: { link: string | null; onClose: () => void }) {
  const [copied, setCopied] = useState(false)
  return (
    <Modal
      open={link !== null}
      onOpenChange={(open) => {
        if (!open) {
          setCopied(false)
          onClose()
        }
      }}
      title="分享制品"
      description="持此链接可查看当前制品。链接在 24 小时后失效。"
      footer={
        <Button
          variant="primary"
          disabled={!link}
          onClick={async () => {
            if (!link) return
            try {
              await navigator.clipboard.writeText(link)
              setCopied(true)
            } catch {
              toast.info('请选中链接后手动复制')
            }
          }}
        >
          {copied ? '已复制' : '复制链接'}
        </Button>
      }
    >
      <input
        type="url"
        aria-label="签名分享链接"
        readOnly
        value={link ?? ''}
        onFocus={(event) => event.target.select()}
        className="w-full rounded border border-border bg-surface p-2 text-sm"
      />
    </Modal>
  )
}
