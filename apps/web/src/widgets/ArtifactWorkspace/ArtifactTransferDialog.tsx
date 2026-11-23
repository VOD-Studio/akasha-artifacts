import {
  type Artifact,
  type ArtifactTransferInput,
  ArtifactTransferInputSchema,
  type Version,
} from '@akasha/protocol'
import { Button } from '@akasha/ui/button'
import { Modal } from '@akasha/ui/dialog'
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
        toast.success('已复制固定版本，新制品的链接和历史独立')
        onCopy(transferred.publicId)
      } else {
        toast.success('制品已移动，原链接和版本历史保持不变')
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
      title={copy ? `复制 v${version.version}` : '移动制品'}
      description={
        copy
          ? '复制当前保存的设计，生成私有制品和新链接；不继承评审、分享、Agent 会话或运行存储。'
          : '改变制品所属项目，保留原链接、版本、反馈和现有访问权。目标存在同名制品时不会覆盖。'
      }
      footer={
        <Button type="submit" form={formId} disabled={disabled} loading={mutation.isPending}>
          {copy ? '复制到项目' : '确认移动'}
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
        <label className="block space-y-1 text-sm">
          <span>目标项目</span>
          <select
            className="w-full rounded-md border border-border bg-surface p-2 text-sm"
            disabled={mutation.isPending || projects.isPending || !choices.length}
            value={selected?.id ?? ''}
            onChange={(event) => setProjectId(event.target.value)}
          >
            <option value="">请选择项目</option>
            {choices.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </label>
        {copy ? (
          <label className="block space-y-1 text-sm">
            <span>新制品标识</span>
            <input
              value={slug}
              onChange={(event) => setSlug(event.target.value)}
              disabled={mutation.isPending}
              spellCheck={false}
              className="w-full rounded-md border border-border bg-surface p-2 font-mono text-sm"
            />
          </label>
        ) : null}
        {projects.isPending ? (
          <p role="status" className="text-sm text-ink-muted">
            正在读取当前服务中的项目…
          </p>
        ) : null}
        {!projects.isPending && !projects.isError && !choices.length ? (
          <p className="text-sm text-ink-muted">
            当前服务没有可用的目标项目。请先在目标项目目录接入 Akasha。
          </p>
        ) : null}
        {mutation.error || projects.error ? (
          <p role="alert" className="text-sm text-error">
            {(mutation.error ?? projects.error)?.message}
          </p>
        ) : null}
        {copy && selected && !payload.success ? (
          <p className="text-sm text-ink-muted">
            请输入由字母、数字、连字符、下划线或斜线组成的标识。
          </p>
        ) : null}
      </form>
    </Modal>
  )
}
