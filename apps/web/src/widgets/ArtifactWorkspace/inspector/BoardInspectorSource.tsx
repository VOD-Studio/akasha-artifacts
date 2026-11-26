import {
  type CanvasLayer,
  type DesignLayer,
  readEditableArtboardSource,
  type VersionSummary,
} from '@akasha/protocol'
import { Button } from '@akasha/ui/button'
import type { ReactNode } from 'react'
import type { CanvasBoard } from '@/entities/artifact'
import { useMessages } from '@/shared/i18n'
import { panelMessages } from './messages'

interface BoardInspectorSourceProps {
  board?: CanvasBoard
  version: VersionSummary
  fullSource?: string
  designLayer?: DesignLayer
  runtimeLayer?: CanvasLayer
  /** 只读或非头版本不提供入口；总是打开整稿而非另一个编辑器。 */
  onOpenEditor?: () => void
}

/** 定位失败时只展示真实所属的画板或版本源码，不给推断的行号。 */
export function BoardInspectorSource({
  board,
  version,
  fullSource,
  designLayer,
  runtimeLayer,
  onOpenEditor,
}: BoardInspectorSourceProps) {
  const { t } = useMessages(panelMessages)
  const fromBoard = Boolean(board?.scoped && !board.generated)
  const source = fromBoard ? board?.source : fullSource
  const scope = fromBoard ? t('画板源码') : t('整份作品快照')
  const authored =
    board && designLayer && fullSource !== undefined
      ? sourceForDesignLayer(fullSource, version.version, board.id, designLayer.id)
      : undefined
  const native = authored ?? (designLayer && JSON.stringify(designLayer, null, 2))
  const excerpt =
    !native && !board?.generated && runtimeLayer && source !== undefined
      ? locateSource(source, runtimeLayer)
      : null
  const fallback =
    runtimeLayer || designLayer ? t('无法定位此图层的源码。以下为{scope}。', { scope }) : scope

  return (
    <section className="flex flex-col gap-2.5 px-4 py-3.5">
      {native && (
        <SourceBlock
          label={
            authored
              ? t('唯一图层声明 · 画板源码')
              : t('原生图层记录 · {version}', { version: `v${version.version}` })
          }
          source={native}
          action={
            onOpenEditor ? (
              <Button
                size="sm"
                variant="outline"
                className="h-7 shrink-0 rounded-[7px] px-2.5 text-xs"
                onClick={onOpenEditor}
              >
                {t('编辑整份源码')}
              </Button>
            ) : undefined
          }
        />
      )}
      {excerpt && (
        <SourceLines
          excerpt={excerpt}
          scope={scope}
          action={
            onOpenEditor ? (
              <Button
                size="sm"
                variant="outline"
                className="h-7 shrink-0 rounded-[7px] px-2.5 text-xs"
                onClick={onOpenEditor}
              >
                {t('编辑整份源码')}
              </Button>
            ) : undefined
          }
        />
      )}
      {!native && !excerpt && source !== undefined && (
        <SourceBlock
          label={fallback}
          source={source}
          action={
            onOpenEditor ? (
              <Button
                size="sm"
                variant="outline"
                className="h-7 shrink-0 rounded-[7px] px-2.5 text-xs"
                onClick={onOpenEditor}
              >
                {t('编辑整份源码')}
              </Button>
            ) : undefined
          }
        />
      )}
      {!native && !excerpt && source === undefined && onOpenEditor ? (
        <div>
          <Button
            size="sm"
            variant="outline"
            className="h-7 rounded-[7px] px-2.5 text-xs"
            onClick={onOpenEditor}
          >
            {t('编辑整份源码')}
          </Button>
        </div>
      ) : null}
    </section>
  )
}

function SourceBlock({
  label,
  source,
  action,
}: {
  label: string
  source: string
  action?: ReactNode
}) {
  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 truncate text-xs text-ink-muted">{label}</p>
        {action}
      </div>
      <pre
        dir="ltr"
        className="w-full font-mono text-[12px] leading-[1.65] whitespace-pre-wrap break-all text-ink"
      >
        <code>{source}</code>
      </pre>
    </>
  )
}

interface SourceExcerpt {
  line: number
  column: number
  firstLine: number
  lines: string[]
  before: string
  tag: string
  after: string
}

function SourceLines({
  excerpt,
  scope,
  action,
}: {
  excerpt: SourceExcerpt
  scope: string
  action?: ReactNode
}) {
  const { t } = useMessages(panelMessages)
  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 text-xs text-ink-muted">
          {t('唯一片段 · {scope}', { scope })} ·{' '}
          <span>
            {t('源码位置')}{' '}
            <bdi dir="ltr">
              {excerpt.line}:{excerpt.column}
            </bdi>
          </span>
        </p>
        {action}
      </div>
      <pre
        dir="ltr"
        className="w-full font-mono text-[12px] leading-[1.65] whitespace-pre-wrap break-all text-ink"
      >
        {excerpt.lines.map((text, index) => {
          const line = excerpt.firstLine + index
          return (
            <code className="block" key={line}>
              <span
                aria-hidden="true"
                className="me-3 inline-block min-w-5 text-end text-ink-muted/75 select-none"
              >
                {line}
              </span>
              {line === excerpt.line ? (
                <>
                  {excerpt.before}
                  <mark className="rounded bg-(--canvas-selection-tint) px-0.5 text-(--canvas-selection-strong)">
                    {excerpt.tag}
                  </mark>
                  {excerpt.after}
                </>
              ) : (
                text || ' '
              )}
            </code>
          )
        })}
      </pre>
    </>
  )
}

function sourceForDesignLayer(source: string, version: number, boardId: string, layerId: string) {
  try {
    const { boards } = readEditableArtboardSource(source, version)
    const raw = boards.get(boardId)?.raw.designLayers
    if (!Array.isArray(raw)) return undefined
    // 原始声明可能含旧版或外部工具字段；不要用经过 schema 归一化的图层冒充原稿。
    const layer = raw.find((entry) => entry?.id === layerId)
    return layer && JSON.stringify(layer, null, 2)
  } catch {
    return undefined
  }
}

function locateSource(source: string, layer: CanvasLayer): SourceExcerpt | null {
  if (!layer.sourceLoc) return null
  const [rawLine, rawColumn] = layer.sourceLoc.split(':')
  const line = Number(rawLine)
  const column = Number(rawColumn)
  if (!Number.isInteger(line) || !Number.isInteger(column) || line < 1 || column < 1) return null
  const lines = source.split(/\r?\n/)
  const sourceLine = lines[line - 1]
  const start = column - 1
  const match = sourceLine?.slice(start).match(/^<([\w:-]+)(?=[\s/>])/)
  if (!sourceLine || match?.[1]?.toLowerCase() !== layer.tag.toLowerCase()) return null
  const firstLine = Math.max(1, line - 3)
  const end = start + match[0].length
  const after = sourceLine.slice(end, end + 160)
  return {
    line,
    column,
    firstLine,
    lines: lines.slice(firstLine - 1, line + 3),
    before: start > 18 ? `…${sourceLine.slice(start - 18, start)}` : sourceLine.slice(0, start),
    tag: match[0],
    after: end + after.length < sourceLine.length ? `${after}…` : after,
  }
}
