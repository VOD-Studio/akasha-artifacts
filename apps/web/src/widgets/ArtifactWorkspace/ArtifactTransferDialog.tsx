import {
  type Artifact,
  type ArtifactTransferInput,
  ArtifactTransferInputSchema,
  type Version,
} from '@akasha/protocol'
import { Button } from '@akasha/ui/button'
import { Modal } from '@akasha/ui/dialog'
import { Field } from '@akasha/ui/field'
import { Input } from '@akasha/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@akasha/ui/select'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useId, useState } from 'react'
import { toast } from 'sonner'
import { artifactKeys } from '../../entities/artifact/queries'
import { useProjectsQuery } from '../../entities/project/queries'
import { transferArtifact } from '../../shared/api/client'

export interface ArtifactTransferTarget {
  artifact: Artifact
  /** 复制只读取打开对话框时选定的固定版本。 */
  version: Version
  kind: ArtifactTransferInput['kind']
}

interface ArtifactTransferDialogProps {
  target: ArtifactTransferTarget
  onCopy: (publicId: string) => void
  onClose: () => void
}

/** 只列出当前服务已授权的项目；同一个表单不会跨 Daemon 或 Hub 发送请求。 */
export function ArtifactTransferDialog({ target, onCopy, onClose }: ArtifactTransferDialogProps) {
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
        toast.success('已复制')
        onCopy(transferred.publicId)
      } else {
        toast.success('已移动')
      }
      onClose()
    },
  })
  const disabled = mutation.isPending || !selected || !payload.success
  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open && !mutation.isPending) onClose()
      }}
      title={copy ? `复制 v${version.version}` : '移动作品'}
      description={
        copy
          ? '生成有独立链接和历史的私有作品，不继承评审、分享权限、Agent 会话或运行存储。'
          : '保留原链接、版本、反馈和现有访问权。不会覆盖目标项目中的同名作品。'
      }
      footer={
        <Button type="submit" form={formId} disabled={disabled} loading={mutation.isPending}>
          {copy ? '复制' : '移动'}
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
        <Field label="目标项目">
          <Select
            disabled={mutation.isPending || projects.isPending || !choices.length}
            loading={projects.isPending}
            value={selected?.id ?? ''}
            onValueChange={setProjectId}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="选择项目" />
            </SelectTrigger>
            <SelectContent>
              {choices.map((project) => (
                <SelectItem key={project.id} value={project.id}>
                  {project.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        {copy && (
          <Field
            label="新作品标识"
            error={
              selected && !payload.success
                ? '标识只能包含字母、数字、连字符、下划线或斜线。'
                : undefined
            }
          >
            <Input
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
            此服务没有可用的目标项目。请先在目标项目目录接入 Akasha。
          </p>
        ) : null}
        {mutation.error || projects.error ? (
          <p role="alert" className="text-sm text-error">
            {(mutation.error ?? projects.error)?.message}
          </p>
        ) : null}
      </form>
    </Modal>
  )
}
