import {
  type Artifact,
  type ArtifactTransferInput,
  ArtifactTransferInputSchema,
  type VersionSummary,
} from '@akasha/protocol'
import { Button } from '@akasha/ui/button'
import { Modal } from '@akasha/ui/dialog'
import { Field } from '@akasha/ui/field'
import { Input } from '@akasha/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@akasha/ui/select'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useId, useState } from 'react'
import { toast } from 'sonner'
import { artifactKeys, transferArtifact } from '@/entities/artifact'
import { useProjectsQuery } from '@/entities/project'
import { getRequestErrorMessage } from '@/shared/api/error'
import { useMessages } from '@/shared/i18n'
import { messages } from '../messages'

export interface ArtifactTransferTarget {
  artifact: Artifact
  /** 复制只读取打开对话框时选定的固定版本。 */
  version: VersionSummary
  kind: ArtifactTransferInput['kind']
}

interface ArtifactTransferDialogProps {
  target: ArtifactTransferTarget
  onCopy: (publicId: string) => void
  onClose: () => void
}

/** 只列出当前服务已授权的项目；同一个表单不会跨 Daemon 或 Hub 发送请求。 */
export function ArtifactTransferDialog({ target, onCopy, onClose }: ArtifactTransferDialogProps) {
  const { t } = useMessages(messages)
  const formId = useId()
  const { artifact, version, kind } = target
  const copy = kind === 'copy'
  const [projectId, setProjectId] = useState(copy ? artifact.projectId : '')
  const [slug, setSlug] = useState(`${artifact.slug}-copy`)
  const projects = useProjectsQuery()
  const choices = (projects.data ?? []).filter(
    (project) => copy || project.id !== artifact.projectId,
  )
  const selected = choices.find((project) => project.id === projectId)
  const payload = ArtifactTransferInputSchema.safeParse(
    copy
      ? { kind, targetProjectId: projectId, version: version.version, slug: slug.trim() }
      : { kind, targetProjectId: projectId },
  )
  const query = useQueryClient()
  const mutation = useMutation({
    mutationFn: (input: ArtifactTransferInput) => transferArtifact(artifact.publicId, input),
    onSuccess: ({ artifact: transferred }) => {
      void query.invalidateQueries({ queryKey: artifactKeys.all })
      if (copy) {
        toast.success(t('已复制'))
        onCopy(transferred.publicId)
      } else {
        toast.success(t('已移动'))
      }
      onClose()
    },
  })
  const error = mutation.error ?? projects.error
  const disabled = mutation.isPending || !selected || !payload.success
  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open && !mutation.isPending) onClose()
      }}
      title={copy ? t('复制 {version}', { version: `v${version.version}` }) : t('移动作品')}
      description={
        copy
          ? t('生成有独立链接和历史的私有作品，不继承评审、分享权限、Agent 会话或运行存储。')
          : t('保留原链接、版本、反馈和现有访问权。不会覆盖目标项目中的同名作品。')
      }
      footer={
        <Button type="submit" form={formId} disabled={disabled} loading={mutation.isPending}>
          {copy ? t('复制') : t('移动')}
        </Button>
      }
    >
      <form
        id={formId}
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault()
          if (!disabled && payload.success) mutation.mutate(payload.data)
        }}
      >
        <Field label={t('目标项目')}>
          <Select
            disabled={mutation.isPending || projects.isPending || !choices.length}
            loading={projects.isPending}
            value={selected?.id ?? ''}
            onValueChange={setProjectId}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder={t('选择项目')} />
            </SelectTrigger>
            <SelectContent>
              {choices.map((project) => (
                <SelectItem key={project.id} value={project.id}>
                  <bdi>{project.name}</bdi>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        {copy && (
          <Field
            label={t('新作品标识')}
            error={
              selected && !payload.success
                ? t('标识只能包含字母、数字、连字符、下划线或斜线。')
                : undefined
            }
          >
            <Input
              dir="ltr"
              value={slug}
              onChange={(event) => setSlug(event.target.value)}
              disabled={mutation.isPending}
              spellCheck={false}
              className="font-mono"
            />
          </Field>
        )}
        {!projects.isPending && !projects.isError && !choices.length ? (
          <p className="text-sm text-ink-muted">
            {t('此服务没有可用的目标项目。请先在目标项目目录接入 Akasha。')}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm text-error">
            {getRequestErrorMessage(error)}
          </p>
        ) : null}
      </form>
    </Modal>
  )
}
