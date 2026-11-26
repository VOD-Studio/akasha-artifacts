import type { Project } from '@akasha/protocol'
import { Button } from '@akasha/ui/button'
import { Modal } from '@akasha/ui/dialog'
import { Field } from '@akasha/ui/field'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@akasha/ui/select'
import { useState } from 'react'
import { useDaemonStatusQuery } from '@/entities/daemon'
import { useWorkspaceStore } from '@/entities/workspace'
import { resolveSandboxOrigin } from '@/shared/config/runtime'
import { useMessages } from '@/shared/i18n'
import { messages } from '../messages'
import { SystemEditor } from './SystemEditor'

interface ImportSystemLauncherProps {
  projects: readonly Project[]
  onOpenArtifact: (id: string) => void
}

function ImportSystemDialog({
  projects,
  onOpenArtifact,
  onClose,
}: ImportSystemLauncherProps & { onClose: () => void }) {
  const { t } = useMessages(messages)
  const [id, setId] = useState(() => {
    const current = useWorkspaceStore.getState().selectedProjectId
    return (
      projects.find((project) => project.id === current)?.id ??
      (projects.length === 1 ? projects[0].id : '')
    )
  })
  const [dirty, setDirty] = useState(false)
  const { data } = useDaemonStatusQuery()
  return (
    <Modal
      open
      dirty={dirty}
      title={t('导入设计系统')}
      size="lg"
      onOpenChange={(visible) => {
        if (!visible) onClose()
      }}
    >
      <div className="space-y-4">
        <Field label={t('项目')}>
          <Select value={id} disabled={dirty} onValueChange={setId}>
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
        {id && (
          <div onChangeCapture={() => setDirty(true)}>
            <SystemEditor
              key={id}
              projectId={id}
              sandboxOrigin={resolveSandboxOrigin(data?.sandboxPort)}
              onSaved={({ artifact }) => {
                onClose()
                onOpenArtifact(artifact.publicId)
              }}
            />
          </div>
        )}
      </div>
    </Modal>
  )
}

/** 开始导入时固定可选项目，库列表在后台刷新失败不卸载正在审阅的本机文件。 */
export function ImportSystemLauncher({ projects, onOpenArtifact }: ImportSystemLauncherProps) {
  const { t } = useMessages(messages)
  const [choices, setChoices] = useState<readonly Project[] | null>(null)
  return (
    <>
      {projects.length > 0 && (
        <Button size="sm" variant="outline" onClick={() => setChoices(projects)}>
          {t('导入设计系统')}
        </Button>
      )}
      {choices && (
        <ImportSystemDialog
          projects={choices}
          onClose={() => setChoices(null)}
          onOpenArtifact={onOpenArtifact}
        />
      )}
    </>
  )
}
