import {
  PR_WALKTHROUGH_TEMPLATE,
  resolveEffectiveProps,
  type WalkthroughDiffMode,
  type WalkthroughFile,
  type WalkthroughLine,
} from '@akasha/kit'
import { useMemo, useSyncExternalStore } from 'react'
import { annotationAnchor, DecisionSourceError, useDecisionRendered } from './decision-shared'
import type { RendererProps } from './registry'

type Side = 'old' | 'new'
type SideBySideRow = { old?: WalkthroughLine; new?: WalkthroughLine }

const BAND = {
  remove: 'bg-rose-50 text-rose-950',
  add: 'bg-emerald-50 text-emerald-950',
  context: 'bg-white text-slate-800',
}
const GLYPH = { remove: '−', add: '+', context: ' ' }

// 同一变更段的删除和新增按出现顺序配对，保持上下文行及两侧行号独立。
function splitRows(lines: readonly WalkthroughLine[]): SideBySideRow[] {
  const result: SideBySideRow[] = []
  let old = 0
  let next = 0
  for (const line of lines) {
    if (line.kind === 'context') {
      result.push({ old: line, new: line })
      old = result.length
      next = result.length
    } else if (line.kind === 'remove') {
      const existing = result[old]
      if (existing) existing.old = line
      else result.push({ old: line })
      old++
    } else {
      const existing = result[next]
      if (existing) existing.new = line
      else result.push({ new: line })
      next++
    }
  }
  return result
}

function LineNumber({
  file,
  line,
  side,
  onRequestAnnotation,
}: {
  file: WalkthroughFile
  line?: WalkthroughLine
  side: Side
  onRequestAnnotation: RendererProps['onRequestAnnotation']
}) {
  const number = line?.[side]
  if (!line || number === undefined) return <td className="w-12 border-r border-slate-100" />
  const blockId = `pr-line:${file.id}:${side}:${number}`
  const description = `${file.path} ${side === 'old' ? '旧版' : '新版'}第 ${number} 行`
  return (
    <td
      data-ak-block={blockId}
      className="w-12 border-r border-slate-200 text-right text-slate-600"
    >
      {onRequestAnnotation ? (
        <button
          type="button"
          className="w-full cursor-pointer px-2 underline decoration-dotted hover:bg-slate-200 focus-visible:outline-2 focus-visible:outline-blue-600"
          aria-label={`批注 ${description}`}
          title={`批注 ${description}`}
          onClick={(event) => {
            onRequestAnnotation({
              ...annotationAnchor(event.currentTarget.parentElement ?? event.currentTarget),
              blockId,
              textPreview: `${description}：${line.text}`.slice(0, 400),
            })
          }}
        >
          {number}
        </button>
      ) : (
        <span className="px-2">{number}</span>
      )}
    </td>
  )
}

function LineText({ line }: { line?: WalkthroughLine }) {
  return (
    <td className={`py-0.5 pr-3 ${line ? BAND[line.kind] : 'bg-slate-50'}`}>
      {line && (
        <>
          <span aria-hidden="true" className="inline-block w-5 text-center">
            {GLYPH[line.kind]}
          </span>
          <code className="whitespace-pre">{line.text}</code>
          {line.noNewline && <span className="ml-2 text-slate-500">（文件末尾无换行）</span>}
        </>
      )}
    </td>
  )
}

function FileDiff({
  file,
  mode,
  onRequestAnnotation,
}: {
  file: WalkthroughFile
  mode: WalkthroughDiffMode
  onRequestAnnotation: RendererProps['onRequestAnnotation']
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-slate-200">
      <header className="border-b border-slate-200 bg-slate-50 px-4 py-3">
        <h3 className="font-mono text-sm font-semibold break-all">{file.path}</h3>
        {file.note && <p className="mt-1 text-sm text-slate-600">{file.note}</p>}
      </header>
      <div className="overflow-x-auto">
        <table
          aria-label={`${file.path} 文件差异`}
          className="w-full border-collapse font-mono text-xs"
        >
          {mode === 'split' && (
            <>
              <colgroup span={2} />
              <colgroup span={2} />
            </>
          )}
          <thead className="bg-slate-50 text-left text-slate-600">
            {mode === 'split' ? (
              <tr>
                <th
                  scope="colgroup"
                  colSpan={2}
                  className="w-1/2 border-r border-slate-200 px-3 py-2"
                >
                  旧版
                </th>
                <th scope="colgroup" colSpan={2} className="w-1/2 px-3 py-2">
                  新版
                </th>
              </tr>
            ) : (
              <tr>
                <th scope="col" className="px-2 py-2 text-right">
                  旧版
                </th>
                <th scope="col" className="px-2 py-2 text-right">
                  新版
                </th>
                <th scope="col" className="px-3 py-2">
                  代码
                </th>
              </tr>
            )}
          </thead>
          {file.hunks.map((hunk) => (
            <tbody key={hunk.header}>
              <tr>
                <td
                  colSpan={mode === 'split' ? 4 : 3}
                  className="bg-blue-50 px-3 py-1 whitespace-pre text-blue-900"
                >
                  {hunk.header}
                </td>
              </tr>
              {mode === 'split'
                ? splitRows(hunk.lines).map(({ old, new: next }) => (
                    <tr key={`${old?.old ?? ''}:${next?.new ?? ''}`}>
                      <LineNumber
                        file={file}
                        line={old}
                        side="old"
                        onRequestAnnotation={onRequestAnnotation}
                      />
                      <LineText line={old} />
                      <LineNumber
                        file={file}
                        line={next}
                        side="new"
                        onRequestAnnotation={onRequestAnnotation}
                      />
                      <LineText line={next} />
                    </tr>
                  ))
                : hunk.lines.map((line) => (
                    <tr key={`${line.old ?? ''}:${line.new ?? ''}`}>
                      <LineNumber
                        file={file}
                        line={line}
                        side="old"
                        onRequestAnnotation={onRequestAnnotation}
                      />
                      <LineNumber
                        file={file}
                        line={line}
                        side="new"
                        onRequestAnnotation={onRequestAnnotation}
                      />
                      <LineText line={line} />
                    </tr>
                  ))}
            </tbody>
          ))}
        </table>
      </div>
    </section>
  )
}

const CHAPTER_KEY = 'pr-walkthrough.chapter'
const DIFF_MODE_KEY = 'pr-walkthrough.diffMode'

export function PrWalkthroughRenderer({
  source,
  version,
  preserved,
  stateStore,
  onRendered,
  onRequestAnnotation,
}: RendererProps) {
  const parsed = useMemo(() => PR_WALKTHROUGH_TEMPLATE.parse(source), [source])
  const viewState = useSyncExternalStore(
    preserved.subscribe,
    preserved.getSnapshot,
    preserved.getSnapshot,
  )
  const state = useSyncExternalStore(
    stateStore.subscribe,
    stateStore.getSnapshot,
    stateStore.getSnapshot,
  )
  const data = parsed.ok ? parsed.data : undefined
  const props = data
    ? resolveEffectiveProps({ title: data.title, diffMode: data.diffMode }, state)
    : undefined
  const defaultMode = props?.diffMode === 'split' ? 'split' : 'unified'
  const savedMode = viewState.controls?.[DIFF_MODE_KEY]
  const mode: WalkthroughDiffMode =
    savedMode === 'split' || savedMode === 'unified' ? savedMode : defaultMode
  const savedChapter = viewState.controls?.[CHAPTER_KEY]
  const chapter = data?.chapters.find((entry) => entry.id === savedChapter) ?? data?.chapters[0]
  useDecisionRendered(source, version, onRendered, `${chapter?.id}:${mode}`)

  if (!parsed.ok) return <DecisionSourceError error={parsed.error} />
  if (!chapter) return null
  return (
    <main data-ak-renderer="pr-walkthrough" className="mx-auto max-w-7xl space-y-5 p-5">
      <header>
        <p className="text-xs font-semibold text-blue-700">代码评审</p>
        <h1 className="mt-1 text-2xl font-semibold">
          {typeof props?.title === 'string' ? props.title : parsed.data.title}
        </h1>
        {parsed.data.summary && (
          <p className="mt-2 text-sm text-slate-600">{parsed.data.summary}</p>
        )}
      </header>
      <nav aria-label="走查章节">
        <ol className="flex flex-wrap gap-2">
          {parsed.data.chapters.map((entry, index) => (
            <li key={entry.id}>
              <button
                type="button"
                aria-current={entry === chapter ? 'step' : undefined}
                className="rounded-md border border-slate-200 px-3 py-1.5 text-sm hover:bg-slate-50 aria-[current=step]:border-blue-300 aria-[current=step]:bg-blue-50 aria-[current=step]:text-blue-900"
                onClick={() => preserved.setControl(CHAPTER_KEY, entry.id)}
              >
                <span aria-hidden="true" className="mr-2 text-slate-500">
                  {index + 1}.
                </span>
                {entry.title}
              </button>
            </li>
          ))}
        </ol>
      </nav>
      <section className="space-y-3" data-ak-block={`pr-chapter:${chapter.id}`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">{chapter.title}</h2>
            {chapter.summary && <p className="mt-1 text-sm text-slate-600">{chapter.summary}</p>}
            {onRequestAnnotation && (
              <p className="mt-1 text-xs text-slate-500">点击旧版或新版行号添加批注。</p>
            )}
          </div>
          <fieldset className="flex gap-1 rounded-lg bg-slate-100 p-1">
            <legend className="sr-only">差异显示方式</legend>
            {(['unified', 'split'] as const).map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={mode === option}
                className="rounded-md px-3 py-1 text-sm text-slate-700 aria-pressed:bg-white aria-pressed:shadow-sm"
                onClick={() => preserved.setControl(DIFF_MODE_KEY, option)}
              >
                {option === 'split' ? '并排' : '统一'}
              </button>
            ))}
          </fieldset>
        </div>
        {chapter.files.map((file) => (
          <FileDiff
            key={file.id}
            file={file}
            mode={mode}
            onRequestAnnotation={onRequestAnnotation}
          />
        ))}
      </section>
    </main>
  )
}
