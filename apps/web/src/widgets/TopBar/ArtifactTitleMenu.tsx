import type { Artifact } from '@akasha/protocol'
import { Button } from '@akasha/ui/button'
import { Modal } from '@akasha/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@akasha/ui/dropdown-menu'
import {
  ChevronDown,
  Code2,
  Download,
  GitCompare,
  HandMetal,
  HardDrive,
  Link2,
  Pencil,
  RefreshCw,
  Search,
  Star,
} from 'lucide-react'
import { useId, useState } from 'react'
import { toast } from 'sonner'
import {
  useArtifactFavoritesQuery,
  useArtifactManagementQuery,
  useReloadArtifactMutation,
  useRenameArtifactMutation,
  useSetArtifactFavoriteMutation,
} from '../../entities/artifact/queries'
import type { WorkspaceViewMode } from '../../entities/workspace/store'
import { HubShareMenuItem } from '../../features/hub/HubActions'
import { ArtifactStorageUsageDialog } from './ArtifactStorageUsageDialog'

interface ArtifactTitleMenuProps {
  artifact: Artifact
  /** 普通链接跟随头版本；固定版本的链接不携带授权参数。 */
  fixedVersion?: number
  agentStatus: string
  onShowTool: (tool: WorkspaceViewMode) => void
  onExport?: () => void
  onHandoff?: () => void
  onShare: (link: string) => void
  onQuickJump: () => void
}

/** 标题菜单管理整份制品；单画板的动作留在画板边界。 */
export function ArtifactTitleMenu({
  artifact,
  fixedVersion,
  agentStatus,
  onShowTool,
  onExport,
  onHandoff,
  onShare,
  onQuickJump,
}: ArtifactTitleMenuProps) {
  const { publicId, title } = artifact
  const management = useArtifactManagementQuery(publicId)
  const rename = useRenameArtifactMutation(publicId)
  const reload = useReloadArtifactMutation(publicId)
  const favorites = useArtifactFavoritesQuery()
  const setFavorite = useSetArtifactFavoriteMutation(publicId)
  const isFavorite = favorites.data?.includes(publicId) ?? false
  const [showUsage, setShowUsage] = useState(false)
  const [name, setName] = useState<string | null>(null)
  const formId = useId()

  async function copyLink() {
    try {
      const path = `/a/${encodeURIComponent(publicId)}${fixedVersion === undefined ? '' : `/v/${fixedVersion}`}`
      await navigator.clipboard.writeText(new URL(path, window.location.origin).href)
      toast.success('制品链接已复制')
    } catch {
      toast.error('无法写入剪贴板')
    }
  }

  return (
    <>
      <DropdownMenu>
        <h1 className="min-w-0">
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              aria-label="制品菜单"
              title={title}
              className="max-w-full"
            >
              <span className="truncate font-semibold">{title}</span>
              <ChevronDown size={14} className="shrink-0 text-ink-muted" />
            </Button>
          </DropdownMenuTrigger>
        </h1>
        <DropdownMenuContent align="start">
          <DropdownMenuItem onSelect={() => void copyLink()}>
            <Link2 size={14} />
            复制制品链接
          </DropdownMenuItem>
          {favorites.data ? (
            <DropdownMenuItem
              disabled={setFavorite.isPending}
              onSelect={() => {
                setFavorite.mutate(!isFavorite, {
                  onSuccess: ({ favorite }) =>
                    toast.success(favorite ? '已收藏制品' : '已取消收藏'),
                  onError: (error) => toast.error(error.message),
                })
              }}
            >
              <Star size={14} />
              {isFavorite ? '取消收藏' : '收藏制品'}
            </DropdownMenuItem>
          ) : null}
          {management.data?.canManage ? (
            <DropdownMenuItem
              onSelect={() => {
                rename.reset()
                setName(title)
              }}
            >
              <Pencil size={14} />
              重命名制品
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem
            disabled={reload.isPending}
            onSelect={() =>
              reload.mutate(undefined, {
                onSuccess: () => toast.success('已重新读取制品'),
                onError: (error) => toast.error(error.message),
              })
            }
          >
            <RefreshCw size={14} />
            重新加载
          </DropdownMenuItem>
          {management.data?.canManage ? (
            <DropdownMenuItem onSelect={() => setShowUsage(true)}>
              <HardDrive size={14} />
              存储用量
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => onShowTool('source')}>
            <Code2 size={14} />
            查看源码
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onShowTool('edit')}>
            <Pencil size={14} />
            编辑代码
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onShowTool('diff')}>
            <GitCompare size={14} />
            对比版本
          </DropdownMenuItem>
          {onExport ? (
            <DropdownMenuItem onSelect={onExport}>
              <Download size={14} />
              导出设计
            </DropdownMenuItem>
          ) : null}
          {onHandoff ? (
            <DropdownMenuItem onSelect={onHandoff}>
              <HandMetal size={14} />
              移交整份给 CLI Agent
            </DropdownMenuItem>
          ) : null}
          {management.data?.canManage ? (
            <HubShareMenuItem publicId={publicId} onShare={onShare} />
          ) : null}
          <DropdownMenuItem onSelect={onQuickJump}>
            <Search size={14} />
            快速跳转
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>{agentStatus}</DropdownMenuLabel>
        </DropdownMenuContent>
      </DropdownMenu>
      {showUsage && management.data?.canManage ? (
        <ArtifactStorageUsageDialog artifactId={publicId} onClose={() => setShowUsage(false)} />
      ) : null}
      {name !== null ? (
        <Modal
          open
          onOpenChange={(open) => {
            if (!open && !rename.isPending) setName(null)
          }}
          title="重命名制品"
          description="仅修改制品的展示名；链接、源码和已有版本不变。"
          footer={
            <>
              <Button variant="ghost" disabled={rename.isPending} onClick={() => setName(null)}>
                取消
              </Button>
              <Button
                type="submit"
                form={formId}
                loading={rename.isPending}
                disabled={!name.trim() || name.trim() === title}
              >
                保存名称
              </Button>
            </>
          }
        >
          <form
            id={formId}
            className="space-y-2"
            onSubmit={(event) => {
              event.preventDefault()
              const next = name.trim()
              if (!next || next === title || rename.isPending) return
              rename.mutate(next, { onSuccess: () => setName(null) })
            }}
          >
            <label className="block text-sm font-medium text-ink" htmlFor={`${formId}-name`}>
              制品名称
            </label>
            <input
              id={`${formId}-name`}
              className="block w-full rounded-md border border-border bg-surface px-2.5 py-2 text-sm text-ink"
              value={name}
              maxLength={240}
              readOnly={rename.isPending}
              onChange={(event) => setName(event.target.value)}
            />
            {rename.error ? (
              <p role="alert" className="text-sm text-error">
                {rename.error.message}
              </p>
            ) : null}
          </form>
        </Modal>
      ) : null}
    </>
  )
}
