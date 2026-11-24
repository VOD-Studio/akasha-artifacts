import type { Artifact, Version } from '@akasha/protocol'
import { Button } from '@akasha/ui/button'
import { Modal } from '@akasha/ui/dialog'
import { Field, FieldSet } from '@akasha/ui/field'
import { Radio, RadioGroup } from '@akasha/ui/radio'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@akasha/ui/select'
import { Download } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { fetchArtifactDetail } from '../../entities/artifact'
import { composeDesignPdf } from '../../features/export-design/design-pdf'
import { captureBoardPng } from '../../shared/bridge/capture-png'
import { type CanvasBoard, createCanvasDocument } from './canvas-model'

/** 打开面板时固定版本；不因 Agent 推进头版本而改变下载内容。 */
export interface DesignExportTarget {
  artifact: Artifact
  version: Version
  /** 从画板就地入口打开时预选该画板；默认整份制品。 */
  boardId?: string
}

interface ExportDialogProps {
  /** 传入已获准读取的快照，只用于显示标题和画板选项。 */
  target: DesignExportTarget
  /** 关闭时中止生成，绝不下载已完成一部分的文件。 */
  onClose: () => void
}

function boardsFor(type: Artifact['type'], version: Version) {
  const boards = new Map<string, { board: CanvasBoard; label: string }>()
  const document = createCanvasDocument(
    type,
    version.title,
    version.source,
    version.version,
    undefined,
  )
  for (const page of document.pages) {
    for (const board of page.boards) {
      // 共享画板只在首次出现处输出，不重复占用 PDF 页。
      if (!boards.has(board.id))
        boards.set(board.id, {
          board,
          label: document.pages.length === 1 ? board.title : `${page.title} · ${board.title}`,
        })
    }
  }
  return { boards, flows: document.flows }
}

function filePart(text: string) {
  return (
    text
      .replace(/[^\p{L}\p{N}_-]+/gu, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || '设计'
  )
}

function downloadFile(file: Blob, name: string) {
  const url = URL.createObjectURL(file)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function captureError(cause: unknown) {
  if (cause instanceof DOMException && cause.name === 'TimeoutError') return '画板渲染超时'
  if (cause instanceof Error) return cause.message
  return '无法生成画面'
}

async function* renderPages(
  boards: readonly CanvasBoard[],
  version: number,
  signal: AbortSignal,
  onProgress: (text: string) => void,
) {
  for (const [index, board] of boards.entries()) {
    signal.throwIfAborted()
    onProgress(`正在渲染 ${index + 1}/${boards.length}：${board.title}`)
    try {
      const png = await captureBoardPng(board, version, 1, signal)
      yield { png, width: board.width, height: board.height }
    } catch (cause) {
      if (signal.aborted) throw signal.reason
      throw new Error(`「${board.title}」：${captureError(cause)}`)
    }
  }
}

/** 同一个入口按指定画板或整份制品导出，始终先重新检查固定版本的访问权。 */
export function ArtifactExportDialog({ target, onClose }: ExportDialogProps) {
  const { artifact, version } = target
  const initialBoards = useMemo(
    () => boardsFor(artifact.type, version).boards,
    [artifact.type, version],
  )
  const [boardId, setBoardId] = useState(target.boardId ?? '')
  const [format, setFormat] = useState<'png' | 'pdf' | 'html'>(target.boardId ? 'png' : 'pdf')
  const [error, setError] = useState('')
  const [progress, setProgress] = useState('')
  const job = useRef<AbortController | null>(null)
  const busy = Boolean(progress)
  const extension = format === 'html' && boardId ? 'zip' : format
  useEffect(() => () => job.current?.abort(), [])

  const selectScope = (value: string) => {
    const next = value === 'design' ? '' : value.slice('board:'.length)
    setBoardId(next)
    setFormat(next ? 'png' : 'pdf')
    setError('')
  }

  const selectFormat = (value: string) => {
    if (value !== 'png' && value !== 'pdf' && value !== 'html') return
    setFormat(value)
    setError('')
  }

  const download = async () => {
    if (job.current) return
    const controller = new AbortController()
    const { signal } = controller
    job.current = controller
    setError('')
    setProgress('正在检查版本访问权限…')
    try {
      const result = await fetchArtifactDetail(artifact.publicId, version.version, signal)
      if (
        result.artifact.publicId !== artifact.publicId ||
        result.version.artifactId !== artifact.publicId ||
        result.version.version !== version.version
      )
        throw new Error('未能读取指定版本')
      const { boards: available, flows } = boardsFor(result.artifact.type, result.version)
      const selected = boardId ? available.get(boardId)?.board : undefined
      if (boardId && !selected) throw new Error('指定版本没有这张画板')
      const boards = selected ? [selected] : Array.from(available.values(), ({ board }) => board)
      if (!boards.length) throw new Error('指定版本没有可导出的画板')
      if (format === 'html') {
        const { composeOfflineDesign } = await import('../../features/export-design/offline-design')
        const output = await composeOfflineDesign(
          {
            title: result.version.title,
            version: result.version.version,
            boards: boards.map((board) => ({
              id: board.id,
              title: board.title,
              legacyId: board.legacyBlockId,
              boardId: board.scoped ? board.id : undefined,
              width: board.width,
              height: board.height,
              type: board.type,
              source: board.source,
              designLayers: board.designLayers,
            })),
            flows,
          },
          Boolean(selected),
          signal,
          setProgress,
        )
        signal.throwIfAborted()
        const suffix = selected ? `-${filePart(selected.title)}` : ''
        downloadFile(
          output,
          `${filePart(result.version.title)}-v${version.version}${suffix}.${extension}`,
        )
        onClose()
        return
      }

      const pages = renderPages(boards, version.version, signal, setProgress)
      const output =
        format === 'png' && selected
          ? (await pages.next()).value?.png
          : await composeDesignPdf(`${result.version.title} · v${version.version}`, pages)
      signal.throwIfAborted()
      if (!output) throw new Error('没有成功渲染的画面')
      const suffix = selected ? `-${filePart(selected.title)}` : ''
      downloadFile(
        output,
        `${filePart(result.version.title)}-v${version.version}${suffix}.${format}`,
      )
      onClose()
    } catch (cause) {
      if (!signal.aborted) setError(cause instanceof Error ? cause.message : '导出失败')
    } finally {
      job.current = null
      if (!signal.aborted) setProgress('')
    }
  }

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      title={target.boardId ? '导出画板' : '导出作品'}
      description={`${version.title} · v${version.version}。仅导出已保存的画板，不含批注和工作区工具。`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button
            leftIcon={<Download size={16} />}
            loading={busy}
            disabled={!initialBoards.size || (boardId !== '' && !initialBoards.has(boardId))}
            onClick={() => void download()}
          >
            导出
          </Button>
        </>
      }
    >
      <div className="space-y-4 text-sm">
        <Field label="导出范围">
          <Select
            value={boardId ? `board:${boardId}` : 'design'}
            disabled={busy || !initialBoards.size}
            onValueChange={selectScope}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="design">整份作品（{initialBoards.size} 张）</SelectItem>
              {[...initialBoards].map(([id, { label }]) => (
                <SelectItem key={id} value={`board:${id}`}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        {initialBoards.size > 0 && (
          <FieldSet legend="格式">
            <RadioGroup
              orientation="horizontal"
              value={format}
              disabled={busy}
              onValueChange={selectFormat}
            >
              {boardId && <Radio value="png" label="PNG" />}
              <Radio value="pdf" label="PDF" />
              <Radio value="html" label={boardId ? 'HTML ZIP' : '离线 HTML'} />
            </RadioGroup>
          </FieldSet>
        )}
        {initialBoards.size === 0 && <p className="text-ink-muted">当前版本没有可导出的画板。</p>}
        {format === 'html' && (
          <p className="text-ink-muted">
            {boardId
              ? '解压后打开 index.html，离线预览所选画板。'
              : '打开 HTML 即可离线预览，支持已定义的跨画板跳转。'}
            不包含运行存储；依赖外部资源的画板无法离线打包。
          </p>
        )}
        {progress ? (
          <p role="status" className="text-ink-muted">
            {progress}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="text-error">
            {error}。未下载文件。
          </p>
        ) : null}
      </div>
    </Modal>
  )
}
