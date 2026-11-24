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

interface LibraryMenuProps {
  projects: readonly Project[]
  onOpenWithdrawn: () => void
}

/** 只接收当前身份能管理的项目；移除登记后清除已失效的筛选。 */
export function LibraryMenu({ projects, onOpenWithdrawn }: LibraryMenuProps) {
  const removeProjectMutation = useRemoveProjectMutation()
  const removeProject = async (project: Project) => {
    try {
      await removeProjectMutation.mutateAsync(project.id)
      const store = useWorkspaceStore.getState()
      if (store.selectedProjectId === project.id) store.setSelectedProjectId(null)
      toast.success(`已移除「${project.name}」的登记`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '移除项目登记失败')
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" iconOnly aria-label="管理作品库" title="管理作品库">
          <Ellipsis size={16} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {projects.length > 0 && <DropdownMenuLabel>项目</DropdownMenuLabel>}
        {projects.map((project) => (
          <DropdownMenuSub key={project.id}>
            <DropdownMenuSubTrigger>
              {project.name}
              {project.dormant && '（休眠）'}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem
                variant="destructive"
                disabled={removeProjectMutation.isPending}
                onSelect={() => void removeProject(project)}
              >
                <Trash2 size={14} />
                移除项目登记
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        ))}
        {projects.length > 0 && <DropdownMenuSeparator />}
        <DropdownMenuItem onSelect={onOpenWithdrawn}>
          <Archive size={14} />
          已撤下
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
