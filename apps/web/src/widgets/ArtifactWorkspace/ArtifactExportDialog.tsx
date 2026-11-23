import type { Artifact, Version } from '@akasha/protocol'
import { Button } from '@akasha/ui/button'
import { Modal } from '@akasha/ui/dialog'
import { Download } from 'lucide-react'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { composeDesignPdf } from '../../features/export-design/design-pdf'
import { fetchArtifactDetail } from '../../shared/api/client'
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
  return boards
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

/** 同一个入口按指定画板或整份制品导出，始终先重新检查固定版本的访问权。 */
export function ArtifactExportDialog({ target, onClose }: ExportDialogProps) {
  const { artifact, version } = target
  const initialBoards = useMemo(() => boardsFor(artifact.type, version), [artifact.type, version])
  const [boardId, setBoardId] = useState(target.boardId ?? '')
  const [format, setFormat] = useState<'png' | 'pdf'>(target.boardId ? 'png' : 'pdf')
  const [error, setError] = useState('')
  const [progress, setProgress] = useState('')
  const job = useRef<AbortController | null>(null)
  const id = useId()
  useEffect(() => () => job.current?.abort(), [])

  async function download() {
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
        throw new Error('服务端未返回指定的制品版本')
      const available = boardsFor(result.artifact.type, result.version)
      const selected = boardId ? available.get(boardId)?.board : undefined
      if (boardId && !selected) throw new Error('指定版本没有这张画板')
      const boards = selected ? [selected] : Array.from(available.values(), ({ board }) => board)
      if (!boards.length) throw new Error('指定版本没有可导出的画板')

      async function* renderPages() {
        for (const [index, board] of boards.entries()) {
          signal.throwIfAborted()
          setProgress(`正在渲染 ${index + 1}/${boards.length}：${board.title}`)
          try {
            const png = await captureBoardPng(board, version.version, 1, signal)
            yield { png, width: board.width, height: board.height }
          } catch (cause) {
            if (signal.aborted) throw signal.reason
            const message =
              cause instanceof DOMException && cause.name === 'TimeoutError'
                ? '画板未能在规定时间内完成渲染'
                : cause instanceof Error
                  ? cause.message
                  : '无法生成画面'
            throw new Error(`「${board.title}」：${message}`)
          }
        }
      }
      const pages = renderPages()
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
      if (!signal.aborted)
        setError(cause instanceof Error ? cause.message : '导出失败，没有下载文件')
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
      title="导出设计"
      description={`${version.title} · v${version.version}。只包含已保存的画板，不包含批注或工作区工具。`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button
            leftIcon={<Download size={16} />}
            disabled={
              Boolean(progress) ||
              !initialBoards.size ||
              (boardId !== '' && !initialBoards.has(boardId))
            }
            onClick={() => void download()}
          >
            下载 {format.toUpperCase()}
          </Button>
        </>
      }
    >
      <div className="space-y-4 text-sm">
        <div className="space-y-1">
          <label htmlFor={`${id}-scope`} className="font-medium">
            导出范围
          </label>
          <select
            id={`${id}-scope`}
            value={boardId}
            disabled={Boolean(progress) || !initialBoards.size}
            className="w-full rounded-md border border-border bg-surface px-2 py-1.5"
            onChange={(event) => {
              const next = event.target.value
              setBoardId(next)
              setFormat(next ? 'png' : 'pdf')
              setError('')
            }}
          >
            <option value="">整份设计（{initialBoards.size} 张）</option>
            {[...initialBoards].map(([id, { label }]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </div>
        {initialBoards.size ? (
          <fieldset className="flex gap-3" disabled={Boolean(progress)}>
            <legend className="mb-1 font-medium">格式</legend>
            {boardId ? (
              <label className="flex items-center gap-1.5">
                <input
                  type="radio"
                  name={`${id}-format`}
                  checked={format === 'png'}
                  onChange={() => setFormat('png')}
                />{' '}
                PNG
              </label>
            ) : null}
            <label className="flex items-center gap-1.5">
              <input
                type="radio"
                name={`${id}-format`}
                checked={format === 'pdf'}
                onChange={() => setFormat('pdf')}
              />{' '}
              PDF
            </label>
          </fieldset>
        ) : (
          <p className="text-ink-muted">当前版本没有可导出的画板。</p>
        )}
        {progress ? (
          <p role="status" className="text-ink-muted">
            {progress}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="text-ink">
            无法导出：{error}。没有下载文件。
          </p>
        ) : null}
      </div>
    </Modal>
  )
}
