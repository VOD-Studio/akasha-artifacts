import {
  type CanvasLayer,
  type DesignLayer,
  readEditableArtboardSource,
  type VersionSummary,
} from '@akasha/protocol'
import { Button } from '@akasha/ui/button'
import type { CanvasBoard } from '@/entities/artifact'

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
  const fromBoard = Boolean(board?.scoped && !board.generated)
  const source = fromBoard ? board?.source : fullSource
  const scope = fromBoard ? '画板源码' : '整份作品快照'
  const authored =
    board && designLayer && fullSource !== undefined
      ? sourceForDesignLayer(fullSource, version.version, board.id, designLayer.id)
      : undefined
  const native = authored ?? (designLayer && JSON.stringify(designLayer, null, 2))
  const excerpt =
    !native && !board?.generated && runtimeLayer && source !== undefined
      ? locateSource(source, runtimeLayer)
      : null
  const fallback = runtimeLayer || designLayer ? `无法定位此图层的源码。以下为${scope}。` : scope

  return (
    <div className="flex flex-col gap-2">
      {native && (
        <SourceBlock
          label={authored ? '唯一图层声明 · 画板源码' : `原生图层记录 · v${version.version}`}
          source={native}
        />
      )}
      {excerpt && <SourceLines excerpt={excerpt} scope={scope} />}
      {!native && !excerpt && source !== undefined && (
        <SourceBlock label={fallback} source={source} />
      )}
      {onOpenEditor && (
        <div>
          <Button size="sm" variant="outline" onClick={onOpenEditor}>
            编辑整份源码
          </Button>
        </div>
      )}
    </div>
  )
}

function SourceBlock({ label, source }: { label: string; source: string }) {
  return (
    <>
      <p className="text-xs text-ink-muted">{label}</p>
      <pre dir="ltr" className="max-h-72 overflow-auto rounded-md bg-muted p-3 text-xs leading-5">
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

function SourceLines({ excerpt, scope }: { excerpt: SourceExcerpt; scope: string }) {
  return (
    <>
      <p className="text-xs text-ink-muted">
        唯一片段 · {scope} ·{' '}
        <span>
          源码位置 {excerpt.line}:{excerpt.column}
        </span>
      </p>
      <pre dir="ltr" className="max-h-72 overflow-auto rounded-md bg-muted p-3 text-xs leading-5">
        {excerpt.lines.map((text, index) => {
          const line = excerpt.firstLine + index
          return (
            <code className="block" key={line}>
              <span
                aria-hidden="true"
                className="me-3 inline-block min-w-6 text-end text-ink-muted"
              >
                {line}
              </span>
              {line === excerpt.line ? (
                <>
                  {excerpt.before}
                  <mark className="rounded bg-accent/20 text-inherit">{excerpt.tag}</mark>
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
