import type { Artifact, ArtifactShareEntry, ArtifactShareInput, Version } from '@akasha/protocol'
import { Button } from '@akasha/ui/button'
import { Modal } from '@akasha/ui/dialog'
import { useMutation } from '@tanstack/react-query'
import { useId, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { createArtifactShare } from '../../shared/api/client'
import { createCanvasDocument } from './canvas-model'

interface ArtifactShareDialogProps {
  artifact: Artifact
  /** 签发时使用打开面板时已经读到的快照；不跟随后台更新。 */
  version: Version
  onClose: () => void
}

const control = 'w-full rounded-md border border-border bg-surface p-2 text-sm'

/** 签名授权与复制普通定位链接分开；只有确认后才签发。 */
export function ArtifactShareDialog({ artifact, version, onClose }: ArtifactShareDialogProps) {
  const formId = useId()
  const [role, setRole] = useState<ArtifactShareInput['role']>('view')
  const [entryKind, setEntryKind] = useState<ArtifactShareEntry['kind']>('artifact')
  const [boardIndex, setBoardIndex] = useState(0)
  const [copied, setCopied] = useState(false)
  const boards = useMemo(() => {
    const document = createCanvasDocument(
      artifact.type,
      version.title,
      version.source,
      version.version,
      undefined,
    )
    return document.pages.flatMap((page) =>
      page.boards
        .filter((board) => board.type === 'html' || board.type === 'react')
        .map((board) => ({
          pageId: page.id,
          boardId: board.id,
          label: `${page.title} / ${board.title}`,
        })),
    )
  }, [artifact.type, version])
  const share = useMutation({
    mutationFn: (input: ArtifactShareInput) => createArtifactShare(artifact.publicId, input),
  })
  const issued = share.data
  const board = boards[boardIndex]
  const entry: ArtifactShareEntry | undefined =
    entryKind === 'artifact'
      ? { kind: entryKind }
      : entryKind === 'version'
        ? { kind: entryKind, version: version.version }
        : board && {
            kind: entryKind,
            version: version.version,
            pageId: board.pageId,
            boardId: board.boardId,
          }

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      title="创建分享链接"
      description="持链接者可在本站访问指定范围。授权默认 24 小时有效；普通定位链接不会授予访问权。"
      footer={
        issued ? (
          <Button
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(issued.url)
                setCopied(true)
              } catch {
                toast.info('请选中链接后手动复制')
              }
            }}
          >
            {copied ? '已复制' : '复制签名链接'}
          </Button>
        ) : (
          <Button
            type="submit"
            form={formId}
            loading={share.isPending}
            disabled={!entry || share.isPending}
          >
            签发链接
          </Button>
        )
      }
    >
      {issued ? (
        <div className="space-y-2">
          <input
            type="url"
            aria-label="签名分享链接"
            readOnly
            value={issued.url}
            onFocus={(event) => event.currentTarget.select()}
            className={control}
          />
          <p className="text-xs text-ink-muted">
            失效时间：{new Date(issued.expiresAt).toLocaleString()}
          </p>
        </div>
      ) : (
        <form
          id={formId}
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault()
            if (entry) share.mutate({ role, entry, ttlSeconds: 24 * 60 * 60 })
          }}
        >
          <label className="block space-y-1 text-sm">
            <span>持链接者权限</span>
            <select
              value={role}
              className={control}
              onChange={(event) => setRole(event.target.value as ArtifactShareInput['role'])}
            >
              <option value="view">仅查看</option>
              <option value="comment">可批注</option>
              <option value="edit" disabled={entryKind !== 'artifact'}>
                可编辑头版本
              </option>
            </select>
          </label>
          <label className="block space-y-1 text-sm">
            <span>打开位置</span>
            <select
              value={entryKind}
              className={control}
              onChange={(event) => {
                const next = event.target.value as ArtifactShareEntry['kind']
                setEntryKind(next)
                if (next !== 'artifact' && role === 'edit') setRole('comment')
              }}
            >
              <option value="artifact">制品 · 跟随头版本</option>
              <option value="version">固定版本 · v{version.version}</option>
              {boards.length ? (
                <option value="play">指定画板试玩 · v{version.version}</option>
              ) : null}
            </select>
          </label>
          {entryKind === 'play' ? (
            <label className="block space-y-1 text-sm">
              <span>试玩画板</span>
              <select
                value={boardIndex}
                className={control}
                onChange={(event) => setBoardIndex(Number(event.target.value))}
              >
                {boards.map((item, i) => (
                  <option key={JSON.stringify([item.pageId, item.boardId])} value={i}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {share.error ? (
            <p role="alert" className="text-sm text-error">
              {share.error.message}
            </p>
          ) : null}
        </form>
      )}
    </Modal>
  )
}
