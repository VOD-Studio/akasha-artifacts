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
import { captureBoardPng } from '@/shared/bridge/capture-png'
import { getMessages, useMessages } from '@/shared/i18n'
import { type CanvasExportSelection, resolveSelectedExportBoards } from './canvas-export-selection'
import { messages } from './export-messages'

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

async function* renderPages(
  boards: readonly LoadedCanvasBoard[],
  version: number,
  scale: 1 | 2,
  signal: AbortSignal,
  onProgress: (current: number, total: number, title: string) => void,
) {
  for (const [index, board] of boards.entries()) {
    signal.throwIfAborted()
    onProgress(index + 1, boards.length, board.title)
    try {
      const png = await captureBoardPng(board, version, scale, signal)
      yield { png, width: board.width, height: board.height }
    } catch (cause) {
      if (signal.aborted) throw signal.reason
      throw new Error(
        getMessages(messages).t('「{title}」：{error}', {
          title: board.title,
          error: captureError(cause),
        }),
      )
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
  const { t } = useMessages(messages)
  const { artifact, version } = props.target
  const query = useArtifactSourceQuery(artifact.publicId, version.version)
  const snapshot = query.data
  const matches = snapshot?.artifactId === artifact.publicId && snapshot.version === version.version
  const mismatch = snapshot && !matches ? t('未能读取指定版本') : undefined
  const error = query.error ? getRequestErrorMessage(query.error) : mismatch
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

  const selectScope = (value: string) => {
    if (value === 'selection' && !selection?.boardIds.length) return
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
    setFormat(value)
    setFailure(undefined)
  }
  const selectScale = (value: string) => {
    if (value !== '1' && value !== '2') return
    setPngScale(value === '1' ? 1 : 2)
    setFailure(undefined)
  }

  const download = async () => {
    if (job.current || !preview || !canDownload) return
    const controller = new AbortController()
    const { signal } = controller
    job.current = controller
    setFailure(undefined)
    setProgress('checking')
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
      if (offline) {
        const { composeOfflineDesign } = await import('@/features/export-design')
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

      const pages = renderPages(
        boards,
        version.version,
        format === 'png' ? pngScale : 1,
        signal,
        (current, total, title) => setProgress({ phase: 'render', current, total, title }),
      )
      let output: Blob | undefined
      if (format === 'png') {
        if (!selected) throw new Error(t('请选择一张画板导出 PNG'))
        output = (await pages.next()).value?.png
      } else {
        const { composeDesignPdf } = await import('@/features/export-design')
        output = await composeDesignPdf(`${result.version.title} · v${version.version}`, pages)
      }
      signal.throwIfAborted()
      if (!output) throw new Error(t('没有成功渲染的画面'))
      let suffix = isSelection ? `-${t('选区')}` : ''
      if (selected) suffix = `-${filePart(selected.title)}`
      if (format === 'png' && pngScale === 2) suffix += '@2x'
      downloadFile(
        output,
        `${filePart(result.version.title)}-v${version.version}${suffix}.${format}`,
      )
      onClose()
    } catch (cause) {
      if (!signal.aborted) setFailure({ cause })
    } finally {
      job.current = null
      if (!signal.aborted) setProgress(undefined)
    }
  }

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose()
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
          <Button variant="ghost" onClick={onClose}>
            {t('取消')}
          </Button>
          <Button
            leftIcon={<Download size={16} />}
            loading={busy}
            disabled={!canDownload}
            onClick={() => void download()}
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
