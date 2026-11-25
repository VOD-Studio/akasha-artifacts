import type { Project } from '@akasha/protocol'
import { Button } from '@akasha/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@akasha/ui/dropdown-menu'
import { Archive, Ellipsis, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { useRemoveProjectMutation } from '@/entities/project'
import { useWorkspaceStore } from '@/entities/workspace'
import { getRequestErrorMessage } from '@/shared/api/error'
import { useMessages } from '@/shared/i18n'
import { messages } from './messages'

interface LibraryMenuProps {
  projects: readonly Project[]
  onOpenWithdrawn: () => void
}

/** 只接收当前身份能管理的项目；移除登记后清除已失效的筛选。 */
export function LibraryMenu({ projects, onOpenWithdrawn }: LibraryMenuProps) {
  const { t, dir } = useMessages(messages)
  const removeProjectMutation = useRemoveProjectMutation()
  const removeProject = async (project: Project) => {
    try {
      await removeProjectMutation.mutateAsync(project.id)
      const store = useWorkspaceStore.getState()
      if (store.selectedProjectId === project.id) store.setSelectedProjectId(null)
      toast.success(t('已移除「{name}」的登记', { name: project.name }))
    } catch (error) {
      toast.error(getRequestErrorMessage(error, t('移除项目登记失败')))
    }
  }

  return (
    <DropdownMenu dir={dir}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          aria-label={t('管理作品库')}
          title={t('管理作品库')}
        >
          <Ellipsis size={16} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {projects.length > 0 && <DropdownMenuLabel>{t('项目')}</DropdownMenuLabel>}
        {projects.map((project) => (
          <DropdownMenuSub key={project.id}>
            <DropdownMenuSubTrigger>
              <bdi>{project.name}</bdi>
              {project.dormant && t('（休眠）')}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem
                variant="destructive"
                disabled={removeProjectMutation.isPending}
                onSelect={() => void removeProject(project)}
              >
                <Trash2 size={14} />
                {t('移除项目登记')}
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        ))}
        {projects.length > 0 && <DropdownMenuSeparator />}
        <DropdownMenuItem onSelect={onOpenWithdrawn}>
          <Archive size={14} />
          {t('已撤下')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
