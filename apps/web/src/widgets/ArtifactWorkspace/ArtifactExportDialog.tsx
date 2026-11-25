import { type Artifact, resolveArtboardTweaks, type VersionSummary } from '@akasha/protocol'
import { Button } from '@akasha/ui/button'
import { Modal } from '@akasha/ui/dialog'
import { Field, FieldSet } from '@akasha/ui/field'
import { Radio, RadioGroup } from '@akasha/ui/radio'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@akasha/ui/select'
import { Download } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  createCanvasDocument,
  fetchArtifactDetail,
  fetchArtifactWorkspace,
  type LoadedCanvasBoard,
  useArtifactSourceQuery,
} from '@/entities/artifact'
import { captureBoardPng } from '@/shared/bridge/capture-png'
import { type CanvasExportSelection, resolveSelectedExportBoards } from './canvas-export-selection'

/** 打开面板时固定版本；不因 Agent 推进头版本而改变下载内容。 */
export interface DesignExportTarget {
  artifact: Artifact
  version: VersionSummary
  /** 从画板就地入口打开时预选该画板；默认整份制品。 */
  boardId?: string
  /** 打开面板时的已保存选区；不随之后的选板或头版本变化。 */
  selection?: CanvasExportSelection
}

interface ExportDialogProps {
  /** 打开对话框时选定的快照；选项按固定版本显示。 */
  target: DesignExportTarget
  /** 关闭时中止生成，绝不下载已完成一部分的文件。 */
  onClose: () => void
}

function boardsFor(type: Artifact['type'], version: VersionSummary, source: string) {
  const boards = new Map<string, { board: LoadedCanvasBoard; label: string }>()
  const document = createCanvasDocument(type, version.title, source, version.version, undefined)
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
  return { boards, document }
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
  boards: readonly LoadedCanvasBoard[],
  version: number,
  scale: 1 | 2,
  signal: AbortSignal,
  onProgress: (text: string) => void,
) {
  for (const [index, board] of boards.entries()) {
    signal.throwIfAborted()
    onProgress(`正在渲染 ${index + 1}/${boards.length}：${board.title}`)
    try {
      const png = await captureBoardPng(board, version, scale, signal)
      yield { png, width: board.width, height: board.height }
    } catch (cause) {
      if (signal.aborted) throw signal.reason
      throw new Error(`「${board.title}」：${captureError(cause)}`)
    }
  }
}

/** 同一个入口按指定画板或整份制品导出，始终先重新检查固定版本的访问权。 */
export function ArtifactExportDialog({ target, onClose }: ExportDialogProps) {
  const { version } = target
  if ('source' in version && typeof version.source === 'string') {
    return <ExportDialog target={target} onClose={onClose} source={version.source} />
  }
  return <QueriedExportDialog target={target} onClose={onClose} />
}

function QueriedExportDialog(props: ExportDialogProps) {
  const { artifact, version } = props.target
  const query = useArtifactSourceQuery(artifact.publicId, version.version)
  const snapshot = query.data
  const matches = snapshot?.artifactId === artifact.publicId && snapshot.version === version.version
  const error = query.error?.message ?? (snapshot && !matches ? '未能读取指定版本' : undefined)
  return (
    <ExportDialog
      {...props}
      source={matches && !query.isError ? snapshot.source : undefined}
      load={{ error, fetching: query.isFetching, retry: () => void query.refetch() }}
    />
  )
}

function ExportDialog({
  target,
  onClose,
  source,
  load,
}: ExportDialogProps & {
  source?: string
  load?: { error?: string; fetching: boolean; retry: () => void }
}) {
  const { artifact, version, selection } = target
  const preview = useMemo(
    () => (source === undefined ? undefined : boardsFor(artifact.type, version, source)),
    [artifact.type, version, source],
  )
  const initialBoards = preview?.boards
  const [scope, setScope] = useState(target.boardId ? `board:${target.boardId}` : 'design')
  const boardId = scope.startsWith('board:') ? scope.slice('board:'.length) : undefined
  const isSelection = scope === 'selection'
  const [pngScale, setPngScale] = useState<1 | 2>(1)
  const [format, setFormat] = useState<'png' | 'pdf' | 'html'>(target.boardId ? 'png' : 'pdf')
  const [error, setError] = useState('')
  const [progress, setProgress] = useState('')
  const job = useRef<AbortController | null>(null)
  const busy = Boolean(progress)
  const extension = format === 'html' && boardId ? 'zip' : format
  const board = boardId ? initialBoards?.get(boardId)?.board : undefined
  const selectionPreview = useMemo(() => {
    if (!isSelection || !preview || !selection) return
    try {
      return { boards: resolveSelectedExportBoards(preview.document, version, selection) }
    } catch (cause) {
      return { error: captureError(cause) }
    }
  }, [isSelection, preview, selection, version])
  const canDownload =
    Boolean(initialBoards?.size) &&
    (!boardId || Boolean(board)) &&
    (!isSelection || Boolean(selectionPreview?.boards?.length))
  useEffect(() => () => job.current?.abort(), [])

  const selectScope = (value: string) => {
    if (value === 'selection' && !selection?.boardIds.length) return
    setScope(value)
    setFormat(value.startsWith('board:') ? 'png' : 'pdf')
    setError('')
  }

  const selectFormat = (value: string) => {
    if (value !== 'png' && value !== 'pdf' && value !== 'html') return
    setFormat(value)
    setError('')
  }
  const selectScale = (value: string) => {
    if (value !== '1' && value !== '2') return
    setPngScale(value === '1' ? 1 : 2)
    setError('')
  }

  const download = async () => {
    if (job.current || !preview || !canDownload) return
    const controller = new AbortController()
    const { signal } = controller
    job.current = controller
    setError('')
    setProgress('正在检查版本访问权限…')
    try {
      // 已加载的画布全文是不可变快照；确认时只需通过同一 ACL 重新读取布局权限。
      const result = await (load
        ? fetchArtifactWorkspace(artifact.publicId, version.version, signal)
        : fetchArtifactDetail(artifact.publicId, version.version, signal))
      if (
        result.artifact.publicId !== artifact.publicId ||
        result.version.artifactId !== artifact.publicId ||
        result.version.version !== version.version
      )
        throw new Error('未能读取指定版本')
      const snapshot =
        'source' in result.version && typeof result.version.source === 'string'
          ? boardsFor(result.artifact.type, result.version, result.version.source)
          : preview
      const selected = boardId ? snapshot.boards.get(boardId)?.board : undefined
      if (boardId && !selected) throw new Error('指定版本没有这张画板')
      let boards: readonly LoadedCanvasBoard[]
      if (isSelection) {
        if (!selection) throw new Error('未选择画板')
        boards =
          snapshot === preview && selectionPreview?.boards
            ? selectionPreview.boards
            : resolveSelectedExportBoards(snapshot.document, version, selection)
      } else if (selected) {
        boards = [selected]
      } else {
        boards = Array.from(snapshot.boards.values(), ({ board }) => board)
      }
      if (!boards.length) throw new Error('指定版本没有可导出的画板')
      if (format === 'html') {
        const { composeOfflineDesign } = await import('@/features/export-design')
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
              boardAppearance: board.appearance,
              boardTweaks: board.tweaks?.length ? resolveArtboardTweaks(board.tweaks) : undefined,
            })),
            flows: snapshot.document.flows,
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

      const pages = renderPages(
        boards,
        version.version,
        format === 'png' ? pngScale : 1,
        signal,
        setProgress,
      )
      let output: Blob | undefined
      if (format === 'png') {
        if (!selected) throw new Error('请选择一张画板导出 PNG')
        output = (await pages.next()).value?.png
      } else {
        const { composeDesignPdf } = await import('@/features/export-design')
        output = await composeDesignPdf(`${result.version.title} · v${version.version}`, pages)
      }
      signal.throwIfAborted()
      if (!output) throw new Error('没有成功渲染的画面')
      let suffix = isSelection ? '-选区' : ''
      if (selected) suffix = `-${filePart(selected.title)}`
      if (format === 'png' && pngScale === 2) suffix += '@2x'
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
            disabled={!canDownload}
            onClick={() => void download()}
          >
            导出
          </Button>
        </>
      }
    >
      <div className="space-y-4 text-sm">
        {initialBoards && (
          <Field label="导出范围">
            <Select
              value={scope}
              disabled={busy || !initialBoards.size}
              onValueChange={selectScope}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="design">整份作品（{initialBoards.size} 张）</SelectItem>
                <SelectItem value="selection" disabled={!selection?.boardIds.length}>
                  选中画板（{selection?.boardIds.length ?? 0} 张）
                </SelectItem>
                {Array.from(initialBoards, ([id, { label }]) => (
                  <SelectItem key={id} value={`board:${id}`}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        )}
        {selectionPreview?.boards && (
          <ol aria-label="选区 PDF 页序" className="max-h-32 list-decimal overflow-auto ps-6">
            {selectionPreview.boards.map((item) => (
              <li key={item.id}>
                <bdi>{item.title}</bdi>
              </li>
            ))}
          </ol>
        )}
        {selectionPreview?.error && (
          <p role="alert" className="text-error">
            {selectionPreview.error}
          </p>
        )}
        {Boolean(initialBoards?.size) && (
          <FieldSet legend="格式">
            <RadioGroup
              orientation="horizontal"
              value={format}
              disabled={busy}
              onValueChange={selectFormat}
            >
              {boardId && <Radio value="png" label="PNG" />}
              <Radio value="pdf" label="PDF" />
              {!isSelection && <Radio value="html" label={boardId ? 'HTML ZIP' : '离线 HTML'} />}
            </RadioGroup>
          </FieldSet>
        )}
        {format === 'png' && board && (
          <FieldSet legend="PNG 倍率">
            <RadioGroup
              orientation="horizontal"
              value={String(pngScale)}
              disabled={busy}
              onValueChange={selectScale}
            >
              <Radio value="1" label="1×" />
              <Radio value="2" label="2×" />
            </RadioGroup>
            <output aria-label="输出像素尺寸" className="text-ink-muted tabular-nums">
              {board.width * pngScale} × {board.height * pngScale} 像素
            </output>
          </FieldSet>
        )}
        {initialBoards?.size === 0 && <p className="text-ink-muted">当前版本没有可导出的画板。</p>}
        {!preview && load?.error && (
          <div role="alert" className="flex flex-wrap items-center gap-2">
            <span className="text-error">无法读取导出版本：{load.error}</span>
            <Button variant="ghost" size="sm" loading={load.fetching} onClick={load.retry}>
              重试
            </Button>
          </div>
        )}
        {!preview && load && !load.error && (
          <p role="status" className="text-ink-muted">
            正在读取导出版本…
          </p>
        )}
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
