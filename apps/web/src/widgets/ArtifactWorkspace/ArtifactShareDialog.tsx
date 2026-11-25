import type {
  ArtboardIndex,
  Artifact,
  ArtifactShareEntry,
  ArtifactShareInput,
  VersionSummary,
} from '@akasha/protocol'
import { Button } from '@akasha/ui/button'
import { Modal } from '@akasha/ui/dialog'
import { Field } from '@akasha/ui/field'
import { Input } from '@akasha/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@akasha/ui/select'
import { useMutation } from '@tanstack/react-query'
import { type FormEvent, useId, useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  type CanvasDocument,
  createArtifactShare,
  createCanvasDocument,
  createCanvasDocumentFromIndex,
  hasVersionSource,
} from '@/entities/artifact'
import { getRequestErrorMessage } from '@/shared/api/error'
import { useMessages } from '@/shared/i18n'
import { messages } from './delivery-messages'

interface ArtifactShareDialogProps {
  artifact: Artifact
  /** 签发时使用打开面板时已经读到的快照；不跟随后台更新。 */
  version: VersionSummary
  canvas?: ArtboardIndex
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
export function ArtifactShareDialog({
  artifact,
  version,
  canvas,
  onClose,
}: ArtifactShareDialogProps) {
  const { t, date } = useMessages(messages)
  const formId = useId()
  const [role, setRole] = useState<ArtifactShareInput['role']>('view')
  const [entryKind, setEntryKind] = useState<ArtifactShareEntry['kind']>('artifact')
  const [boardIndex, setBoardIndex] = useState(0)
  const [copying, setCopying] = useState(false)
  const [copied, setCopied] = useState(false)
  const boards = useMemo(() => {
    let document: CanvasDocument | undefined
    if (canvas) {
      document = createCanvasDocumentFromIndex(canvas)
    } else if (hasVersionSource(version)) {
      document = createCanvasDocument(
        artifact.type,
        version.title,
        version.source,
        version.version,
        undefined,
      )
    }
    if (!document) return []
    return document.pages.flatMap((page) =>
      page.boards
        .filter((board) => board.type === 'html' || board.type === 'react')
        .map((board) => ({
          pageId: page.id,
          boardId: board.id,
          label: `${page.title} / ${board.title}`,
        })),
    )
  }, [artifact.type, canvas, version])
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
      toast.info(t('请手动复制链接'))
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
      title={t('创建分享链接')}
      description={t('持链接者可按所选权限访问，授权有效期为 24 小时。普通定位链接不授予访问权。')}
      footer={
        <>
          {issued && (
            <Button loading={copying} onClick={() => void copyLink()}>
              {copied ? t('已复制') : t('复制链接')}
            </Button>
          )}
          {!issued && (
            <Button type="submit" form={formId} loading={share.isPending} disabled={!entry}>
              {t('创建链接')}
            </Button>
          )}
        </>
      }
    >
      {issued && (
        <div className="space-y-2">
          <Input
            type="url"
            dir="ltr"
            aria-label={t('分享链接')}
            readOnly
            value={issued.url}
            onFocus={(event) => event.currentTarget.select()}
          />
          <p className="text-xs text-ink-muted">
            {t('失效时间：{time}', {
              time: date(new Date(issued.expiresAt), { dateStyle: 'medium', timeStyle: 'short' }),
            })}
          </p>
        </div>
      )}
      {!issued && (
        <form id={formId} className="space-y-3" onSubmit={submit}>
          <Field label={t('持链接者权限')}>
            <Select value={role} disabled={share.isPending} onValueChange={selectRole}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="view">{t('仅查看')}</SelectItem>
                <SelectItem value="comment">{t('可批注')}</SelectItem>
                <SelectItem value="edit" disabled={entryKind !== 'artifact'}>
                  {t('可编辑最新版本')}
                </SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label={t('打开位置')}>
            <Select value={entryKind} disabled={share.isPending} onValueChange={selectEntry}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="artifact">{t('作品 · 跟随最新版本')}</SelectItem>
                <SelectItem value="version">
                  {t('固定版本')} · <bdi dir="ltr">v{version.version}</bdi>
                </SelectItem>
                {boards.length > 0 && (
                  <SelectItem value="play">
                    {t('交互预览')} · <bdi dir="ltr">v{version.version}</bdi>
                  </SelectItem>
                )}
              </SelectContent>
            </Select>
          </Field>
          {entryKind === 'play' && (
            <Field label={t('画板')}>
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
                      <bdi>{item.label}</bdi>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}
          {share.error && (
            <p role="alert" className="text-sm text-error">
              {getRequestErrorMessage(share.error)}
            </p>
          )}
        </form>
      )}
    </Modal>
  )
}
