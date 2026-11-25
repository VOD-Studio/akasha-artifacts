import type { Artifact, VersionSummary } from '@akasha/protocol'
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
import { getRequestErrorMessage } from '@/shared/api/error'
import { captureBoardPng, captureBoardPrintPages } from '@/shared/bridge/capture-png'
import { getMessages, useMessages } from '@/shared/i18n'
import {
  type CanvasExportSelection,
  resolveSelectedExportBoards,
} from '../lib/canvas-export-selection'
import { messages } from '../messages'
import { PrintPreview } from './PrintPreview'

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
      .slice(0, 80) || getMessages(messages).t('设计')
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
  const { t } = getMessages(messages)
  if (cause instanceof DOMException && cause.name === 'TimeoutError') return t('画板渲染超时')
  return getRequestErrorMessage(cause, t('无法生成画面'))
}

function boardCaptureError(board: LoadedCanvasBoard, cause: unknown, signal: AbortSignal) {
  signal.throwIfAborted()
  return new Error(
    getMessages(messages).t('「{title}」：{error}', {
      title: board.title,
      error: captureError(cause),
    }),
  )
}

async function* renderPages(
  boards: readonly LoadedCanvasBoard[],
  version: number,
  previewImages: Blob[] | undefined,
  signal: AbortSignal,
  onProgress: (current: number, total: number, title: string) => void,
) {
  for (const [index, board] of boards.entries()) {
    signal.throwIfAborted()
    onProgress(index + 1, boards.length, board.title)
    try {
      let rendered = false
      for await (const page of captureBoardPrintPages(board, version, signal)) {
        signal.throwIfAborted()
        rendered = true
        previewImages?.push(page.png)
        yield page
      }
      if (!rendered) throw new Error(getMessages(messages).t('没有成功渲染的画面'))
    } catch (cause) {
      throw boardCaptureError(board, cause, signal)
    }
  }
}

/** 同一个入口按指定画板或整份制品导出，始终先重新检查固定版本的访问权。 */
export function ArtifactExportDialog({ target, onClose }: ExportDialogProps) {
  const { version } = target
  const key = JSON.stringify([
    target.artifact.publicId,
    version.version,
    target.boardId,
    target.selection,
  ])
  if ('source' in version && typeof version.source === 'string') {
    return <ExportDialog key={key} target={target} onClose={onClose} source={version.source} />
  }
  return <QueriedExportDialog key={key} target={target} onClose={onClose} />
}

function QueriedExportDialog(props: ExportDialogProps) {
  const { t } = useMessages(messages)
  const { artifact, version } = props.target
  const query = useArtifactSourceQuery(artifact.publicId, version.version)
  const snapshot = query.data
  const matches = snapshot?.artifactId === artifact.publicId && snapshot.version === version.version
  const mismatch = snapshot && !matches ? t('未能读取指定版本') : undefined
  const error = query.error ? getRequestErrorMessage(query.error) : mismatch
  return (
    <ExportDialog
      key={matches && !query.isError ? 'loaded' : 'unavailable'}
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
  const { t, number, locale } = useMessages(messages)
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
  const [format, setFormat] = useState<'png' | 'pdf' | 'board-zip' | 'design-html' | 'design-zip'>(
    target.boardId ? 'png' : 'pdf',
  )
  const [failure, setFailure] = useState<{ cause: unknown }>()
  const error = failure && getRequestErrorMessage(failure.cause, t('导出失败'))
  const [progress, setProgress] = useState<
    'checking' | { phase: 'render' | 'preflight'; current: number; total: number; title: string }
  >()
  const job = useRef<AbortController | null>(null)
  const [printPreview, setPrintPreview] = useState<{ pages: Blob[]; pdf: Blob }>()
  const [previewing, setPreviewing] = useState(false)
  const busy = Boolean(progress)
  const offline = format === 'design-html' || format === 'design-zip' || format === 'board-zip'
  const board = boardId ? initialBoards?.get(boardId)?.board : undefined
  const selectionPreview = useMemo(() => {
    if (!isSelection || !preview || !selection) return
    try {
      return { boards: resolveSelectedExportBoards(preview.document, version, selection, locale) }
    } catch (cause) {
      return { error: captureError(cause) }
    }
  }, [isSelection, preview, selection, version, locale])
  const canDownload =
    Boolean(initialBoards?.size) &&
    (!boardId || Boolean(board)) &&
    (!isSelection || Boolean(selectionPreview?.boards?.length))
  useEffect(() => () => job.current?.abort(), [])
  const cancel = () => {
    job.current?.abort()
    onClose()
  }

  const selectScope = (value: string) => {
    if (value === 'selection' && !selection?.boardIds.length) return
    setPrintPreview(undefined)
    setScope(value)
    setFormat(value.startsWith('board:') ? 'png' : 'pdf')
    setFailure(undefined)
  }

  const selectFormat = (value: string) => {
    if (
      value !== 'pdf' &&
      !(boardId && (value === 'png' || value === 'board-zip')) &&
      !(scope === 'design' && (value === 'design-html' || value === 'design-zip'))
    )
      return
    setPrintPreview(undefined)
    setFormat(value)
    setFailure(undefined)
  }
  const selectScale = (value: string) => {
    if (value !== '1' && value !== '2') return
    setPngScale(value === '1' ? 1 : 2)
    setFailure(undefined)
  }

  const runExport = async (action: 'preview' | 'download') => {
    if (job.current || !preview || !canDownload) return
    const controller = new AbortController()
    const { signal } = controller
    job.current = controller
    setPreviewing(action === 'preview')
    setFailure(undefined)
    setProgress('checking')
    try {
      // 已加载的画布全文是不可变快照；确认时只需通过同一 ACL 重新读取布局权限。
      const result = await (load
        ? fetchArtifactWorkspace(artifact.publicId, version.version, signal)
        : fetchArtifactDetail(artifact.publicId, version.version, signal))
      signal.throwIfAborted()
      if (
        result.artifact.publicId !== artifact.publicId ||
        result.version.artifactId !== artifact.publicId ||
        result.version.version !== version.version
      )
        throw new Error(t('未能读取指定版本'))
      const snapshot =
        'source' in result.version && typeof result.version.source === 'string'
          ? boardsFor(result.artifact.type, result.version, result.version.source)
          : preview
      const selected = boardId ? snapshot.boards.get(boardId)?.board : undefined
      if (boardId && !selected) throw new Error(t('指定版本没有这张画板'))
      let boards: readonly LoadedCanvasBoard[]
      if (isSelection) {
        if (!selection) throw new Error(t('未选择画板'))
        boards =
          snapshot === preview && selectionPreview?.boards
            ? selectionPreview.boards
            : resolveSelectedExportBoards(snapshot.document, version, selection)
      } else if (selected) {
        boards = [selected]
      } else {
        boards = Array.from(snapshot.boards.values(), ({ board }) => board)
      }
      if (!boards.length) throw new Error(t('指定版本没有可导出的画板'))
      // 只加载本次导出格式的生成器，打开弹窗或导出 PNG 不需要离线打包器和 PDF 库。
      if (offline) {
        const { composeOfflineDesign } = await import('../offline/offline-design')
        const output = await composeOfflineDesign(
          {
            title: result.version.title,
            version: result.version.version,
            pages: selected
              ? []
              : snapshot.document.pages.map(({ id, title, boards }) => ({
                  id,
                  title,
                  boardIds: boards.map((board) => board.id),
                })),
            boards,
            flows: snapshot.document.flows,
          },
          format,
          signal,
          (current, total, title) => setProgress({ phase: 'preflight', current, total, title }),
        )
        signal.throwIfAborted()
        const suffix = selected ? `-${filePart(selected.title)}` : ''
        const extension = format === 'design-html' ? 'html' : 'zip'
        downloadFile(
          output,
          `${filePart(result.version.title)}-v${version.version}${suffix}.${extension}`,
        )
        onClose()
        return
      }

      const reportRender = (current: number, total: number, title: string) =>
        setProgress({ phase: 'render', current, total, title })
      let output: Blob
      if (format === 'png') {
        if (!selected) throw new Error(t('请选择一张画板导出 PNG'))
        reportRender(1, 1, selected.title)
        try {
          output = await captureBoardPng(selected, version.version, pngScale, signal)
        } catch (cause) {
          throw boardCaptureError(selected, cause, signal)
        }
      } else if (printPreview) {
        // 下载已预览的同一文件；重新渲染会改变动画或依赖时间的内容。
        output = printPreview.pdf
      } else {
        const { composeDesignPdf } = await import('../lib/design-pdf')
        const images: Blob[] | undefined = action === 'preview' ? [] : undefined
        const pages = renderPages(boards, version.version, images, signal, reportRender)
        output = await composeDesignPdf(`${result.version.title} · v${version.version}`, pages)
        if (images) {
          signal.throwIfAborted()
          setPrintPreview({ pages: images, pdf: output })
          return
        }
      }
      signal.throwIfAborted()
      let suffix = isSelection ? `-${t('选区')}` : ''
      if (selected) suffix = `-${filePart(selected.title)}`
      if (format === 'png' && pngScale === 2) suffix += '@2x'
      downloadFile(
        output,
        `${filePart(result.version.title)}-v${version.version}${suffix}.${format}`,
      )
      onClose()
    } catch (cause) {
      if (!signal.aborted) {
        setPrintPreview(undefined)
        setFailure({ cause })
      }
    } finally {
      job.current = null
      if (!signal.aborted) setProgress(undefined)
    }
  }

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) cancel()
      }}
      title={target.boardId ? t('导出画板') : t('导出作品')}
      description={t('{snapshot}。仅导出已保存的画板，不含批注和工作区工具。', {
        snapshot:
          locale === 'ar'
            ? `\u2068${version.title}\u2069 · \u2066v${version.version}\u2069`
            : `${version.title} · v${version.version}`,
      })}
      footer={
        <>
          <Button variant="ghost" onClick={cancel}>
            {t('取消')}
          </Button>
          {format === 'pdf' && (
            <Button
              variant="outline"
              loading={busy && previewing}
              disabled={busy || !canDownload || Boolean(printPreview)}
              onClick={() => void runExport('preview')}
            >
              {t('打印预览')}
            </Button>
          )}
          <Button
            leftIcon={<Download size={16} />}
            loading={busy && !previewing}
            disabled={busy || !canDownload}
            onClick={() => void runExport('download')}
          >
            {t('导出')}
          </Button>
        </>
      }
    >
      <div className="space-y-4 text-sm">
        {initialBoards && (
          <Field label={t('导出范围')}>
            <Select
              value={scope}
              disabled={busy || !initialBoards.size}
              onValueChange={selectScope}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="design">
                  {t('整份作品（{count} 张）', { count: initialBoards.size })}
                </SelectItem>
                <SelectItem value="selection" disabled={!selection?.boardIds.length}>
                  {t('选中画板（{count} 张）', { count: selection?.boardIds.length ?? 0 })}
                </SelectItem>
                {Array.from(initialBoards, ([id, { label }]) => (
                  <SelectItem key={id} value={`board:${id}`}>
                    <bdi>{label}</bdi>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        )}
        {selectionPreview?.boards && (
          <ol aria-label={t('选区 PDF 页序')} className="max-h-32 list-decimal overflow-auto ps-6">
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
          <FieldSet legend={t('格式')}>
            <RadioGroup
              orientation="horizontal"
              value={format}
              disabled={busy}
              onValueChange={selectFormat}
            >
              {boardId && <Radio value="png" label="PNG" />}
              <Radio value="pdf" label="PDF" />
              {boardId && <Radio value="board-zip" label="HTML ZIP" />}
              {scope === 'design' && <Radio value="design-html" label={t('离线 HTML')} />}
              {scope === 'design' && <Radio value="design-zip" label={t('离线 ZIP')} />}
            </RadioGroup>
          </FieldSet>
        )}
        {format === 'png' && board && (
          <FieldSet legend={t('PNG 倍率')}>
            <RadioGroup
              orientation="horizontal"
              value={String(pngScale)}
              disabled={busy}
              onValueChange={selectScale}
            >
              <Radio value="1" label={`${number(1)}×`} />
              <Radio value="2" label={`${number(2)}×`} />
            </RadioGroup>
            <output
              dir="ltr"
              aria-label={t('输出像素尺寸')}
              className="text-ink-muted tabular-nums"
            >
              {t('{width} × {height} 像素', {
                width: number(board.width * pngScale, { useGrouping: false }),
                height: number(board.height * pngScale, { useGrouping: false }),
              })}
            </output>
          </FieldSet>
        )}
        {printPreview && <PrintPreview pages={printPreview.pages} />}
        {initialBoards?.size === 0 && (
          <p className="text-ink-muted">{t('当前版本没有可导出的画板。')}</p>
        )}
        {!preview && load?.error && (
          <div role="alert" className="flex flex-wrap items-center gap-2">
            <span className="text-error">
              {t('无法读取导出版本：{error}', { error: load.error })}
            </span>
            <Button variant="ghost" size="sm" loading={load.fetching} onClick={load.retry}>
              {t('重试')}
            </Button>
          </div>
        )}
        {!preview && load && !load.error && (
          <p role="status" className="text-ink-muted">
            {t('正在读取导出版本…')}
          </p>
        )}
        {offline && (
          <p className="text-ink-muted">
            {format === 'board-zip' && t('解压后打开 index.html，离线预览所选画板。')}
            {format === 'design-html' && t('打开 HTML 即可离线预览，支持已定义的跨画板跳转。')}
            {format === 'design-zip' && t('解压整个 ZIP 后打开 index.html，离线浏览各页和画板。')}{' '}
            {t('不包含运行存储；依赖外部资源的画板无法离线打包。')}
          </p>
        )}
        {progress ? (
          <p role="status" className="text-ink-muted">
            {progress === 'checking'
              ? t('正在检查版本访问权限…')
              : t(
                  progress.phase === 'render'
                    ? '正在渲染 {current}/{total}：{title}'
                    : '正在预检 {current}/{total}：{title}',
                  progress,
                )}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="text-error">
            {t('{error}。未下载文件。', { error: error.replace(/[.。]$/, '') })}
          </p>
        ) : null}
      </div>
    </Modal>
  )
}
