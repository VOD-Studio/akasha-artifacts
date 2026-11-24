import type { Artifact, ArtifactTransferInput } from '@akasha/protocol'
import { Button } from '@akasha/ui/button'
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
  Copy,
  Download,
  FolderInput,
  GitCompare,
  HandMetal,
  HardDrive,
  Link2,
  Pencil,
  RefreshCw,
  Search,
  Star,
  Trash2,
} from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { useArtifactFavoritesQuery, useSetArtifactFavoriteMutation } from '@/entities/artifact'
import type { WorkspaceViewMode } from '@/entities/workspace'
import { ArtifactStorageUsageDialog } from './ArtifactStorageUsageDialog'
import { ArtifactWithdrawalDialog } from './ArtifactWithdrawalDialog'
import { RenameArtifactDialog } from './RenameArtifactDialog'
import { useReloadArtifactMutation } from './use-reload-artifact'

interface ArtifactTitleMenuProps {
  artifact: Artifact
  /** 普通链接跟随头版本；固定版本的链接不携带授权参数。 */
  fixedVersion?: number
  statusLabel?: string
  canManage: boolean
  onShowTool: (tool: WorkspaceViewMode) => void
  onExport?: () => void
  onHandoff?: () => void
  onTransfer?: (kind: ArtifactTransferInput['kind']) => void
  onWithdrawn?: () => void
  canEdit?: boolean
  shared?: boolean
  onQuickJump: () => void
}

/** 标题菜单管理整份制品；单画板的动作留在画板边界。 */
export function ArtifactTitleMenu({
  artifact,
  fixedVersion,
  statusLabel,
  canManage,
  onShowTool,
  onExport,
  onHandoff,
  onTransfer,
  onWithdrawn,
  canEdit = true,
  shared = false,
  onQuickJump,
}: ArtifactTitleMenuProps) {
  const { publicId, title } = artifact
  const reload = useReloadArtifactMutation(publicId)
  const favorites = useArtifactFavoritesQuery()
  const setFavorite = useSetArtifactFavoriteMutation(publicId)
  const isFavorite = favorites.data?.includes(publicId) ?? false
  const [showUsage, setShowUsage] = useState(false)
  const [showWithdrawal, setShowWithdrawal] = useState(false)
  const [showRename, setShowRename] = useState(false)
  const openRename = () => setShowRename(true)
  const closeRename = () => setShowRename(false)

  const toggleFavorite = () => {
    setFavorite.mutate(!isFavorite, {
      onSuccess: ({ favorite }) => toast.success(favorite ? '已收藏' : '已取消收藏'),
      onError: (error) => toast.error(error.message),
    })
  }
  const reloadArtifact = () => {
    reload.mutate(undefined, {
      onSuccess: () => toast.success('已重新加载'),
      onError: (error) => toast.error(error.message),
    })
  }

  const copyLink = async () => {
    try {
      const path = `/a/${encodeURIComponent(publicId)}${fixedVersion === undefined ? '' : `/v/${fixedVersion}`}`
      await navigator.clipboard.writeText(new URL(path, window.location.origin).href)
      toast.success('已复制链接')
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
              aria-label="作品菜单"
              title={title}
              className="max-w-full"
            >
              <span dir="auto" className="truncate font-semibold">
                {title}
              </span>
              <ChevronDown size={14} className="shrink-0 text-ink-muted" />
            </Button>
          </DropdownMenuTrigger>
        </h1>
        <DropdownMenuContent align="start">
          <DropdownMenuItem onSelect={() => void copyLink()}>
            <Link2 size={14} />
            复制链接
          </DropdownMenuItem>
          {!shared && favorites.data ? (
            <DropdownMenuItem disabled={setFavorite.isPending} onSelect={toggleFavorite}>
              <Star size={14} />
              {isFavorite ? '取消收藏' : '收藏'}
            </DropdownMenuItem>
          ) : null}
          {canManage ? (
            <DropdownMenuItem onSelect={openRename}>
              <Pencil size={14} />
              重命名
            </DropdownMenuItem>
          ) : null}
          {onTransfer && canManage ? (
            <>
              <DropdownMenuItem onSelect={() => onTransfer('copy')}>
                <Copy size={14} />
                创建副本…
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onTransfer('move')}>
                <FolderInput size={14} />
                移动到项目…
              </DropdownMenuItem>
            </>
          ) : null}
          <DropdownMenuItem disabled={reload.isPending} onSelect={reloadArtifact}>
            <RefreshCw size={14} />
            重新加载
          </DropdownMenuItem>
          {canManage ? (
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
          {canEdit ? (
            <DropdownMenuItem onSelect={() => onShowTool('edit')}>
              <Pencil size={14} />
              编辑代码
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem onSelect={() => onShowTool('diff')}>
            <GitCompare size={14} />
            对比版本
          </DropdownMenuItem>
          {onExport ? (
            <DropdownMenuItem onSelect={onExport}>
              <Download size={14} />
              导出
            </DropdownMenuItem>
          ) : null}
          {onHandoff ? (
            <DropdownMenuItem onSelect={onHandoff}>
              <HandMetal size={14} />
              移交给 Agent
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem onSelect={onQuickJump}>
            <Search size={14} />
            快速跳转
          </DropdownMenuItem>
          {statusLabel && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>{statusLabel}</DropdownMenuLabel>
            </>
          )}
          {onWithdrawn && canManage ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => setShowWithdrawal(true)}>
                <Trash2 size={14} />
                撤下…
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      {showUsage && canManage ? (
        <ArtifactStorageUsageDialog artifactId={publicId} onClose={() => setShowUsage(false)} />
      ) : null}
      {showWithdrawal && onWithdrawn && canManage ? (
        <ArtifactWithdrawalDialog
          artifact={artifact}
          onClose={() => setShowWithdrawal(false)}
          onWithdrawn={onWithdrawn}
        />
      ) : null}
      {showRename && canManage && (
        <RenameArtifactDialog artifact={artifact} onClose={closeRename} />
      )}
    </>
  )
}
