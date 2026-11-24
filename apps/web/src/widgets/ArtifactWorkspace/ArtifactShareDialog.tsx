import type { Artifact, ArtifactShareEntry, ArtifactShareInput, Version } from '@akasha/protocol'
import { Button } from '@akasha/ui/button'
import { Modal } from '@akasha/ui/dialog'
import { Field } from '@akasha/ui/field'
import { Input } from '@akasha/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@akasha/ui/select'
import { useMutation } from '@tanstack/react-query'
import { type FormEvent, useId, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { createArtifactShare, createCanvasDocument } from '@/entities/artifact'

interface ArtifactShareDialogProps {
  artifact: Artifact
  /** 签发时使用打开面板时已经读到的快照；不跟随后台更新。 */
  version: Version
  onClose: () => void
}

function shareEntry(
  kind: ArtifactShareEntry['kind'],
  version: number,
  board: { pageId: string; boardId: string } | undefined,
): ArtifactShareEntry | undefined {
  if (kind === 'artifact') return { kind }
  if (kind === 'version') return { kind, version }
  if (board) return { kind, version, pageId: board.pageId, boardId: board.boardId }
}

/** 签名授权与复制普通定位链接分开；只有确认后才签发。 */
export function ArtifactShareDialog({ artifact, version, onClose }: ArtifactShareDialogProps) {
  const formId = useId()
  const [role, setRole] = useState<ArtifactShareInput['role']>('view')
  const [entryKind, setEntryKind] = useState<ArtifactShareEntry['kind']>('artifact')
  const [boardIndex, setBoardIndex] = useState(0)
  const [copying, setCopying] = useState(false)
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
  const entry = shareEntry(entryKind, version.version, boards[boardIndex])

  const selectEntry = (next: string) => {
    if (next !== 'artifact' && next !== 'version' && next !== 'play') return
    setEntryKind(next)
    if (next !== 'artifact' && role === 'edit') setRole('comment')
  }

  const selectRole = (next: string) => {
    if (next === 'view' || next === 'comment' || (next === 'edit' && entryKind === 'artifact')) {
      setRole(next)
    }
  }

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (entry && !share.isPending) share.mutate({ role, entry, ttlSeconds: 24 * 60 * 60 })
  }

  const copyLink = async () => {
    if (!issued || copying) return
    setCopying(true)
    try {
      await navigator.clipboard.writeText(issued.url)
      setCopied(true)
    } catch {
      toast.info('请手动复制链接')
    } finally {
      setCopying(false)
    }
  }

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      title="创建分享链接"
      description="持链接者可按所选权限访问，授权有效期为 24 小时。普通定位链接不授予访问权。"
      footer={
        <>
          {issued && (
            <Button loading={copying} onClick={() => void copyLink()}>
              {copied ? '已复制' : '复制链接'}
            </Button>
          )}
          {!issued && (
            <Button type="submit" form={formId} loading={share.isPending} disabled={!entry}>
              创建链接
            </Button>
          )}
        </>
      }
    >
      {issued && (
        <div className="space-y-2">
          <Input
            type="url"
            aria-label="分享链接"
            readOnly
            value={issued.url}
            onFocus={(event) => event.currentTarget.select()}
          />
          <p className="text-xs text-ink-muted">
            失效时间：{new Date(issued.expiresAt).toLocaleString()}
          </p>
        </div>
      )}
      {!issued && (
        <form id={formId} className="space-y-3" onSubmit={submit}>
          <Field label="持链接者权限">
            <Select value={role} disabled={share.isPending} onValueChange={selectRole}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="view">仅查看</SelectItem>
                <SelectItem value="comment">可批注</SelectItem>
                <SelectItem value="edit" disabled={entryKind !== 'artifact'}>
                  可编辑最新版本
                </SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="打开位置">
            <Select value={entryKind} disabled={share.isPending} onValueChange={selectEntry}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="artifact">作品 · 跟随最新版本</SelectItem>
                <SelectItem value="version">固定版本 · v{version.version}</SelectItem>
                {boards.length > 0 && (
                  <SelectItem value="play">交互预览 · v{version.version}</SelectItem>
                )}
              </SelectContent>
            </Select>
          </Field>
          {entryKind === 'play' && (
            <Field label="画板">
              <Select
                value={String(boardIndex)}
                disabled={share.isPending}
                onValueChange={(value) => setBoardIndex(Number(value))}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {boards.map((item, index) => (
                    <SelectItem
                      key={JSON.stringify([item.pageId, item.boardId])}
                      value={String(index)}
                    >
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}
          {share.error && (
            <p role="alert" className="text-sm text-error">
              {share.error.message}
            </p>
          )}
        </form>
      )}
    </Modal>
  )
}
