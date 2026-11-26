import type { Project } from '@akasha/protocol'
import { Button } from '@akasha/ui/button'
import { Modal } from '@akasha/ui/dialog'
import { Field } from '@akasha/ui/field'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@akasha/ui/select'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useWorkspaceStore } from '@/entities/workspace'
import { useMessages } from '@/shared/i18n'
import { catalogOptions } from '../api/catalog'
import { messages } from '../messages'
import { componentKey } from '../model/review'
import { PublicationControls } from './PublicationControls'

interface SystemCatalogProps {
  projects: readonly Project[]
  admin: boolean
}

function CatalogItems({ projectId, admin }: { projectId: string; admin: boolean }) {
  const { t } = useMessages(messages)
  const catalog = useQuery(catalogOptions(projectId))
  if (catalog.isPending) return <p role="status">{t('正在读取')}</p>
  if (catalog.isError)
    return (
      <div role="alert">
        {t('无法读取系统目录')}{' '}
        <Button variant="outline" onClick={() => void catalog.refetch()}>
          {t('重试')}
        </Button>
      </div>
    )
  if (!catalog.data.items.length) return <p>{t('无可用系统版本')}</p>
  return (
    <ul className="space-y-3">
      {catalog.data.items.map((item) => (
        <li key={`${item.id}:${item.version}`} className="space-y-2 border-t border-border pt-3">
          <h3 className="flex flex-wrap items-baseline gap-2 font-medium">
            <bdi>{item.title}</bdi> <span>v{item.version}</span>
          </h3>
          <code dir="ltr" className="break-all">
            {item.id}
          </code>
          {item.isDefault && <p>{t('团队默认')}</p>}
          {item.publication === 'team' && !item.isDefault && <p>{t('已发布到团队')}</p>}
          {item.components.length > 0 && (
            <ul>
              {item.components.map((entry) => (
                <li key={componentKey(entry)}>
                  <code dir="ltr">{componentKey(entry)}</code>
                </li>
              ))}
            </ul>
          )}
          {admin && (
            <PublicationControls
              projectId={projectId}
              id={item.id}
              version={item.version}
              publication={item.publication}
              isDefault={item.isDefault}
            />
          )}
        </li>
      ))}
    </ul>
  )
}

/** 成员只在本人项目中选择固定版本，不从目录跳到来源作品。 */
export function SystemCatalogLauncher({ projects, admin }: SystemCatalogProps) {
  const { t } = useMessages(messages)
  const [selected, setSelected] = useState<string | null>(null)
  const projectId = projects.find((p) => p.id === selected)?.id ?? ''
  const open = () => {
    const current = useWorkspaceStore.getState().selectedProjectId
    setSelected(
      projects.find((p) => p.id === current)?.id ?? (projects.length === 1 ? projects[0].id : ''),
    )
  }
  return (
    <>
      <Button size="sm" variant="outline" onClick={open}>
        {t('系统目录')}
      </Button>
      {selected !== null && (
        <Modal
          open
          size="lg"
          title={t('系统目录')}
          onOpenChange={(visible) => {
            if (!visible) setSelected(null)
          }}
        >
          <div className="space-y-4">
            <Field label={t('项目')}>
              <Select value={projectId} onValueChange={setSelected} disabled={!projects.length}>
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
            {projectId && <CatalogItems key={projectId} projectId={projectId} admin={admin} />}
          </div>
        </Modal>
      )}
    </>
  )
}
