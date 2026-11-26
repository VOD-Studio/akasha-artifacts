import type { CatalogSelection, Project } from '@akasha/protocol'
import { Button } from '@akasha/ui/button'
import { Modal } from '@akasha/ui/dialog'
import { Field } from '@akasha/ui/field'
import { Input } from '@akasha/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@akasha/ui/select'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { artifactKeys } from '@/entities/artifact'
import { useWorkspaceStore } from '@/entities/workspace'
import { useMessages } from '@/shared/i18n'
import { catalogOptions, generateCatalogDesign } from '../api/catalog'
import { messages } from '../messages'
import { CatalogSelections } from './CatalogSelections'

interface CatalogDesignDialogProps {
  projects: readonly Project[]
  onClose: () => void
  onCreated: (id: string) => void
}

const modes = {
  preference: '使用个人设置',
  none: '本次不使用系统',
  choose: '选择系统版本',
} as const

/** Hub 直接创建独立作品；本次系统选择不修改个人偏好或团队默认。 */
export function CatalogDesignDialog({ projects, onClose, onCreated }: CatalogDesignDialogProps) {
  const { t } = useMessages(messages)
  const cache = useQueryClient()
  const [projectId, setProjectId] = useState(() => {
    const current = useWorkspaceStore.getState().selectedProjectId
    return (
      projects.find((p) => p.id === current)?.id ?? (projects.length === 1 ? projects[0].id : '')
    )
  })
  const [title, setTitle] = useState('')
  const [slug] = useState(() => `design/${crypto.randomUUID()}`)
  const [mode, setMode] = useState<string>('preference')
  const [selections, setSelections] = useState<CatalogSelection[]>([])
  const targetAvailable = projects.some((p) => p.id === projectId)
  const catalog = useQuery({ ...catalogOptions(projectId), enabled: targetAvailable })
  const teamDefault = catalog.data?.items.find((item) => item.isDefault)
  const create = useMutation({
    mutationFn: () => {
      const input = { slug, title: title.trim() }
      if (mode === 'preference') return generateCatalogDesign(projectId, input)
      return generateCatalogDesign(projectId, {
        ...input,
        selections: mode === 'choose' ? selections : [],
      })
    },
    onSuccess: ({ artifact }) => {
      void cache.invalidateQueries({ queryKey: artifactKeys.lists })
      onCreated(artifact.publicId)
    },
  })
  const changeProject = (id: string) => {
    setProjectId(id)
    setSelections([])
    setMode('preference')
    create.reset()
  }
  return (
    <Modal
      open
      size="lg"
      title={t('新建设计')}
      onOpenChange={(visible) => {
        if (!visible && !create.isPending) onClose()
      }}
    >
      <fieldset className="space-y-4" disabled={create.isPending}>
        <Field label={t('设计名称')}>
          <Input dir="auto" value={title} onChange={(event) => setTitle(event.target.value)} />
        </Field>
        <Field label={t('项目')}>
          <Select
            value={targetAvailable ? projectId : ''}
            onValueChange={changeProject}
            disabled={create.isPending}
          >
            <SelectTrigger>
              <SelectValue placeholder={t('选择项目')} />
            </SelectTrigger>
            <SelectContent>
              {projects.map((project) => (
                <SelectItem key={project.id} value={project.id}>
                  {project.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        {targetAvailable && catalog.isPending && <p role="status">{t('正在读取')}</p>}
        {targetAvailable && catalog.isError && (
          <div role="alert">
            {t('无法读取系统目录')}{' '}
            <Button onClick={() => void catalog.refetch()}>{t('重试')}</Button>
          </div>
        )}
        {targetAvailable && catalog.isSuccess && (
          <>
            <Field label={t('本次设计系统')}>
              <Select value={mode} onValueChange={setMode} disabled={create.isPending}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(modes).map(([key, label]) => (
                    <SelectItem key={key} value={key}>
                      {t(label)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            {mode === 'preference' && catalog.data.inheritDefault && teamDefault && (
              <p>
                {t('团队默认')} ·{' '}
                <bdi>
                  {teamDefault.title} · {teamDefault.id} · v{teamDefault.version}
                </bdi>
              </p>
            )}
            {mode === 'preference' && !catalog.data.inheritDefault && <p>{t('未继承团队默认')}</p>}
            {mode === 'preference' && catalog.data.inheritDefault && !teamDefault && (
              <p>{t('尚无团队默认')}</p>
            )}
            {mode === 'choose' && (
              <CatalogSelections
                items={catalog.data.items}
                selections={selections}
                onChange={setSelections}
              />
            )}
          </>
        )}
        {create.isError && <p role="alert">{t('未能创建设计')}</p>}
        <Button
          loading={create.isPending}
          disabled={
            !title.trim() ||
            !targetAvailable ||
            !catalog.isSuccess ||
            (mode === 'choose' && selections.length === 0)
          }
          onClick={() => create.mutate()}
        >
          {t('创建')}
        </Button>
      </fieldset>
    </Modal>
  )
}
