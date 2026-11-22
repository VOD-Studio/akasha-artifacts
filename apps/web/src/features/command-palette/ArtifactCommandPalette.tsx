import { type CommandGroup, type CommandItem, CommandList } from '@akasha/ui/command'
import { FileCode2, FolderGit2, Home } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useArtifactsQuery } from '../../entities/artifact/queries'
import { useProjectsQuery } from '../../entities/project/queries'
import { useWorkspaceStore } from '../../entities/workspace/store'
import { ARTIFACT_TYPE_LABELS } from '../../shared/lib/format'

export interface ArtifactCommandPaletteProps {
  onNavigate: (to: string) => void
}

const GROUPS: CommandGroup[] = [
  { id: 'artifacts', label: 'Artifact 页面' },
  { id: 'projects', label: '已登记项目' },
  { id: 'actions', label: '导航与快捷操作' },
]

// ⌘K 跨项目全局命令面板：支持标题/slug/项目模糊搜索，↵ 当前页打开，⌘↵ 新标签打开。
export function ArtifactCommandPalette({ onNavigate }: ArtifactCommandPaletteProps) {
  const open = useWorkspaceStore((s) => s.commandPaletteOpen)
  const setOpen = useWorkspaceStore((s) => s.setCommandPaletteOpen)
  const setSelectedProjectId = useWorkspaceStore((s) => s.setSelectedProjectId)
  const [query, setQuery] = useState('')

  const { data: projects = [] } = useProjectsQuery()
  const { data: artifacts = [] } = useArtifactsQuery()

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setOpen(!useWorkspaceStore.getState().commandPaletteOpen)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [setOpen])

  useEffect(() => {
    if (!open) setQuery('')
  }, [open])

  const projectMap = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects])

  const items = useMemo<CommandItem[]>(() => {
    const artifactItems: CommandItem[] = artifacts.map((art) => {
      const project = projectMap.get(art.projectId)
      const path = `/a/${art.publicId}`
      return {
        id: `artifact:${art.publicId}`,
        group: 'artifacts',
        label: art.title,
        description: `${project?.name ?? art.projectId} · ${art.slug} · v${art.headVersion}`,
        hint: ARTIFACT_TYPE_LABELS[art.type] ?? art.type,
        icon: <FileCode2 size={15} />,
        keywords: [art.slug, art.publicId, art.type, project?.name ?? '', art.projectId],
        onSelect: ({ newTab }) => {
          if (newTab) {
            window.open(path, '_blank', 'noopener,noreferrer')
          } else {
            onNavigate(path)
          }
        },
      }
    })

    const projectItems: CommandItem[] = projects.map((proj) => ({
      id: `project:${proj.id}`,
      group: 'projects',
      label: proj.name,
      description: proj.rootPath,
      hint: proj.dormant ? '休眠' : '活跃',
      icon: <FolderGit2 size={15} />,
      keywords: [proj.id, proj.rootPath],
      onSelect: ({ newTab }) => {
        if (newTab) {
          window.open('/', '_blank', 'noopener,noreferrer')
        } else {
          setSelectedProjectId(proj.id)
          onNavigate('/')
        }
      },
    }))

    const actionItems: CommandItem[] = [
      {
        id: 'action:home',
        group: 'actions',
        label: '回到多项目库（最近 · 所有项目）',
        icon: <Home size={15} />,
        keywords: ['home', 'library', 'all', 'projects'],
        onSelect: ({ newTab }) => {
          if (newTab) {
            window.open('/', '_blank', 'noopener,noreferrer')
          } else {
            setSelectedProjectId(null)
            onNavigate('/')
          }
        },
      },
    ]

    return [...artifactItems, ...projectItems, ...actionItems]
  }, [artifacts, projects, projectMap, onNavigate, setSelectedProjectId])

  return (
    <CommandList
      open={open}
      onOpenChange={setOpen}
      items={items}
      groups={GROUPS}
      query={query}
      onQueryChange={setQuery}
      limit={8}
      placeholder="跨项目检索 Artifact、项目或操作…"
    />
  )
}
