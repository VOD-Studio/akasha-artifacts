import { type CommandGroup, type CommandItem, CommandList } from '@akasha/ui/command'
import { FileCode2, FolderGit2, Home } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useArtifactsQuery } from '@/entities/artifact'
import { useProjectsQuery } from '@/entities/project'
import { useWorkspaceStore } from '@/entities/workspace'
import { useMessages } from '@/shared/i18n'
import { artifactTypeLabel } from '@/shared/lib/format'
import { messages } from './messages'

export interface ArtifactCommandPaletteProps {
  onNavigate: (to: string) => void
}

/**
 * ⌘K 跨项目命令面板：按标题、slug 或项目模糊搜索制品。
 *
 * @remarks 回车在当前页打开，⌘回车在新标签打开。
 */
export function ArtifactCommandPalette({ onNavigate }: ArtifactCommandPaletteProps) {
  const { t, locale } = useMessages(messages)
  const groups = useMemo<CommandGroup[]>(
    () => [
      { id: 'artifacts', label: t('作品') },
      { id: 'projects', label: t('项目') },
      { id: 'actions', label: t('操作') },
    ],
    [t],
  )
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
        description: project?.name,
        hint: artifactTypeLabel(art.type, locale),
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
      descriptionDir: 'ltr',
      hint: proj.dormant ? t('休眠') : undefined,
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
        label: t('打开作品库'),
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
  }, [artifacts, projects, projectMap, onNavigate, setSelectedProjectId, t, locale])

  return (
    <CommandList
      open={open}
      onOpenChange={setOpen}
      items={items}
      groups={groups}
      labels={{
        title: t('命令面板'),
        searching: t('正在搜索全文'),
        results: t('结果'),
        fullText: t('全文'),
        empty: t('没有找到结果'),
        tryFullText: t('试试在全文里搜索。'),
        tryKeywords: t('试试其他关键词。'),
        searchAll: t('在全文里搜索'),
        select: t('选择'),
        open: t('打开'),
        newTab: t('新标签打开'),
        searchWithin: (label) => t('在「{label}」里搜索', { label }),
        count: (count) => t('{count} 项', { count }),
      }}
      query={query}
      onQueryChange={setQuery}
      limit={8}
      placeholder={t('搜索作品、项目或操作…')}
    />
  )
}
