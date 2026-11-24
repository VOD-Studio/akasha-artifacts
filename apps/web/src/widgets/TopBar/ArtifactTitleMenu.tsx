import type { Artifact, ArtifactTransferInput } from '@akasha/protocol'
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
import { Field } from '@akasha/ui/field'
import { Input } from '@akasha/ui/input'
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
import { useId, useState } from 'react'
import { toast } from 'sonner'
import {
  useArtifactFavoritesQuery,
  useReloadArtifactMutation,
  useRenameArtifactMutation,
  useSetArtifactFavoriteMutation,
} from '../../entities/artifact/queries'
import type { WorkspaceViewMode } from '../../entities/workspace/store'
import { ArtifactStorageUsageDialog } from './ArtifactStorageUsageDialog'
import { ArtifactWithdrawalDialog } from './ArtifactWithdrawalDialog'

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
  const rename = useRenameArtifactMutation(publicId)
  const reload = useReloadArtifactMutation(publicId)
  const favorites = useArtifactFavoritesQuery()
  const setFavorite = useSetArtifactFavoriteMutation(publicId)
  const isFavorite = favorites.data?.includes(publicId) ?? false
  const [showUsage, setShowUsage] = useState(false)
  const [showWithdrawal, setShowWithdrawal] = useState(false)
  const [name, setName] = useState<string | null>(null)
  const formId = useId()

  const copyLink = async () => {
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
            复制制品链接
          </DropdownMenuItem>
          {!shared && favorites.data ? (
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
          {canManage ? (
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
          {onTransfer && canManage ? (
            <>
              <DropdownMenuItem onSelect={() => onTransfer('copy')}>
                <Copy size={14} />
                复制制品…
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onTransfer('move')}>
                <FolderInput size={14} />
                移动到项目…
              </DropdownMenuItem>
            </>
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
              导出设计
            </DropdownMenuItem>
          ) : null}
          {onHandoff ? (
            <DropdownMenuItem onSelect={onHandoff}>
              <HandMetal size={14} />
              移交整份给 CLI Agent
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
                撤下制品…
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
      {name !== null ? (
        <Modal
          open
          onOpenChange={(open) => {
            if (!open && !rename.isPending) setName(null)
          }}
          title="重命名制品"
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
            <Field label="制品名称" error={rename.error?.message}>
              <Input
                value={name}
                maxLength={240}
                readOnly={rename.isPending}
                onChange={(event) => setName(event.currentTarget.value)}
              />
            </Field>
          </form>
        </Modal>
      ) : null}
    </>
  )
}
