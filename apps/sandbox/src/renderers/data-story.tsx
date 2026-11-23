import {
  DATA_STORY_TEMPLATE,
  type DataStoryData,
  resolveEffectiveProps,
  type StoryChart,
  type StoryRow,
  type StoryTable,
} from '@akasha/kit'
import { DATA_POINT_SELECTION_LIMITS, type ElementRef } from '@akasha/protocol'
import { useId, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { annotationAnchor, DecisionSourceError, useDecisionRendered } from './decision-shared'
import type { RendererProps } from './registry'

type Dataset = DataStoryData['datasets'][number]
type Annotation = NonNullable<RendererProps['onRequestAnnotation']>
type Point = NonNullable<ElementRef['dataPoints']>['points'][number]

interface ChartDrag {
  pointerId: number
  x: number
  y: number
  active: boolean
}

function selectionRect(drag: ChartDrag, x: number, y: number): DOMRect {
  return new DOMRect(
    Math.min(drag.x, x),
    Math.min(drag.y, y),
    Math.abs(drag.x - x),
    Math.abs(drag.y - y),
  )
}

function pointLabel(point: Point): string {
  return `${point.label || '（空白）'}：${point.value}`
}

function pointAnchor(chartId: string, datasetId: string, rowId: string): string {
  return `data-point:${chartId}:${datasetId}:${rowId}`
}

function StoryBars({
  dataset,
  chart,
  rows,
  onRequestAnnotation,
}: {
  dataset: Dataset
  chart: StoryChart
  rows: readonly StoryRow[]
  onRequestAnnotation?: Annotation
}) {
  const root = useRef<HTMLElement>(null)
  const titleId = useId()
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set())
  const lastPoint = useRef<string | undefined>(undefined)
  const [limitReached, setLimitReached] = useState(false)
  const drag = useRef<ChartDrag | undefined>(undefined)
  const ignoreClick = useRef(false)
  const [brush, setBrush] = useState<DOMRect | undefined>()
  const points = useMemo(
    () =>
      rows.map(
        (row): Point => ({
          id: row.id,
          label: String(row.values.get(chart.category.id)),
          value: Number(row.values.get(chart.value.id)),
        }),
      ),
    [chart, rows],
  )
  const { min, max } = useMemo(() => {
    let min = 0
    let max = 0
    for (const row of dataset.rows) {
      const value = Number(row.values.get(chart.value.id))
      if (value < min) min = value
      if (value > max) max = value
    }
    return { min, max }
  }, [chart.value.id, dataset.rows])
  // 先缩放再算跨度，避免正负极值相减时溢出；筛选不改变图表比例。
  const normalizer = Math.max(Math.abs(min), max) || 1
  const scale = max / normalizer - min / normalizer || 1
  const axis = (-min / normalizer / scale) * 100
  const selectedPoints = points.filter((point) => selected.has(point.id))
  const chartAnchor = `data-chart:${chart.id}:${dataset.id}`

  function selectPoint(point: Point, index: number, range: boolean) {
    const anchorIndex = range ? points.findIndex((entry) => entry.id === lastPoint.current) : -1
    const next = new Set(selectedPoints.map((entry) => entry.id))
    if (anchorIndex >= 0) {
      for (let i = Math.min(index, anchorIndex); i <= Math.max(index, anchorIndex); i++) {
        next.add(points[i].id)
        if (next.size > DATA_POINT_SELECTION_LIMITS.points) break
      }
    } else if (!next.delete(point.id)) {
      next.add(point.id)
    }
    const limited = next.size > DATA_POINT_SELECTION_LIMITS.points
    setLimitReached(limited)
    if (!limited) {
      lastPoint.current = point.id
      setSelected(next)
    }
  }

  function selectBrush(plot: HTMLElement, rect: DOMRect) {
    const next = new Set<string>()
    let last: string | undefined
    for (const mark of plot.querySelectorAll<HTMLElement>('[data-story-point]')) {
      const bounds = mark.getBoundingClientRect()
      if (
        bounds.right < rect.left ||
        bounds.left > rect.right ||
        bounds.bottom < rect.top ||
        bounds.top > rect.bottom
      )
        continue
      last = mark.dataset.storyPoint
      if (last) next.add(last)
      if (next.size > DATA_POINT_SELECTION_LIMITS.points) {
        setLimitReached(true)
        return
      }
    }
    setLimitReached(false)
    lastPoint.current = last
    setSelected(next)
  }

  function requestAnnotation() {
    const first = selectedPoints[0]
    if (!first || !onRequestAnnotation || !root.current) return
    const single = selectedPoints.length === 1
    const blockId = single
      ? pointAnchor(chart.id, dataset.id, first.id)
      : `data-points:${chart.id}:${dataset.id}:${selectedPoints
          .map((point) => point.id)
          .sort()
          .join(',')}`
    const selector = `[data-ak-block="${chartAnchor}"]`
    const target = single
      ? (root.current.querySelector(`[data-ak-block="${blockId}"]`) ?? root.current)
      : root.current
    onRequestAnnotation({
      ...annotationAnchor(target),
      blockId,
      selector,
      textPreview: `${chart.title} · ${selectedPoints.map(pointLabel).join('；')}`.slice(0, 400),
      dataPoints: {
        datasetId: dataset.id,
        chartId: chart.id,
        chartTitle: chart.title,
        valueLabel: chart.value.label,
        points: selectedPoints,
      },
    })
  }

  return (
    <section
      ref={root}
      data-ak-block={chartAnchor}
      aria-labelledby={titleId}
      className="rounded-xl border border-slate-200 p-4"
    >
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 id={titleId} className="text-sm font-semibold">
            {chart.title}
          </h3>
          <p className="mt-1 text-xs text-slate-600">
            {chart.category.label} · {chart.value.label}
          </p>
        </div>
        {onRequestAnnotation && selectedPoints.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="rounded-md px-2 py-1 text-xs text-slate-600 hover:bg-slate-100"
              onClick={() => {
                setSelected(new Set())
                setLimitReached(false)
                lastPoint.current = undefined
              }}
            >
              清除选择
            </button>
            <button
              type="button"
              className="rounded-md bg-blue-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-800"
              onClick={requestAnnotation}
            >
              批注选中的 {selectedPoints.length} 个数据点
            </button>
          </div>
        )}
      </header>
      {onRequestAnnotation && points.length > 0 && (
        <p className="mt-2 text-xs text-slate-500">
          拖动框选数据点，也可以点击柱条或按 Shift 连选。
        </p>
      )}
      {limitReached && (
        <output className="mt-2 block text-xs text-amber-800">
          每条批注最多包含 {DATA_POINT_SELECTION_LIMITS.points} 个数据点。
        </output>
      )}
      {points.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">没有符合筛选条件的数据点。</p>
      ) : (
        <ul
          className={`relative mt-3 space-y-1 ${onRequestAnnotation ? 'select-none' : ''}`}
          aria-label={chart.value.label}
          onPointerDown={(event) => {
            if (!onRequestAnnotation || !event.isPrimary || event.button !== 0) return
            ignoreClick.current = false
            if (event.pointerType === 'touch') return
            drag.current = {
              pointerId: event.pointerId,
              x: event.clientX,
              y: event.clientY,
              active: false,
            }
          }}
          onPointerMove={(event) => {
            const current = drag.current
            if (current?.pointerId !== event.pointerId) return
            const rect = selectionRect(current, event.clientX, event.clientY)
            if (!current.active) {
              if (Math.max(rect.width, rect.height) < 4) return
              current.active = true
              event.currentTarget.setPointerCapture?.(event.pointerId)
            }
            const plot = event.currentTarget.getBoundingClientRect()
            rect.x -= plot.left
            rect.y -= plot.top
            setBrush(rect)
          }}
          onPointerUp={(event) => {
            const current = drag.current
            if (current?.pointerId !== event.pointerId) return
            drag.current = undefined
            if (!current.active) return
            ignoreClick.current = true
            setBrush(undefined)
            selectBrush(event.currentTarget, selectionRect(current, event.clientX, event.clientY))
          }}
          onPointerCancel={() => {
            drag.current = undefined
            setBrush(undefined)
          }}
          onPointerLeave={() => {
            if (!drag.current?.active) drag.current = undefined
          }}
        >
          {points.map((point, index) => {
            const chosen = selected.has(point.id)
            const width = (Math.abs(point.value) / normalizer / scale) * 100
            const left = point.value < 0 ? Math.max(0, axis - width) : axis
            const label = pointLabel(point)
            const contents = (
              <>
                <span aria-hidden="true" className="truncate" title={point.label}>
                  {point.label || '（空白）'}
                </span>
                <span aria-hidden="true" className="relative h-4 rounded-sm bg-slate-100">
                  {min < 0 && max > 0 && (
                    <span
                      className="absolute inset-y-0 w-px bg-slate-400"
                      style={{ left: `${axis}%` }}
                    />
                  )}
                  <span
                    data-story-point={point.id}
                    className={`absolute inset-y-1 min-w-px rounded-xs ${chosen ? 'bg-blue-800' : 'bg-blue-500'}`}
                    style={{ left: `${left}%`, width: `${width}%` }}
                  />
                </span>
                <span aria-hidden="true" className="text-right tabular-nums">
                  {point.value}
                </span>
              </>
            )
            const grid =
              'grid w-full grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto] items-center gap-3 rounded-md px-2 py-1.5 text-left text-sm'
            const blockId = pointAnchor(chart.id, dataset.id, point.id)
            return (
              <li key={point.id}>
                {onRequestAnnotation ? (
                  <button
                    type="button"
                    data-ak-block={blockId}
                    aria-label={label}
                    aria-pressed={chosen}
                    className={`${grid} hover:bg-slate-50 aria-pressed:bg-blue-100 focus-visible:outline-2 focus-visible:outline-blue-600`}
                    onClick={(event) => {
                      if (!ignoreClick.current || event.detail === 0)
                        selectPoint(point, index, event.shiftKey)
                      ignoreClick.current = false
                    }}
                  >
                    {contents}
                  </button>
                ) : (
                  <div data-ak-block={blockId} className={grid}>
                    <span className="sr-only">{label}</span>
                    {contents}
                  </div>
                )}
              </li>
            )
          })}
          {brush && (
            <li
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 !m-0 overflow-hidden"
            >
              <span
                className="absolute border border-blue-600 bg-blue-500/15"
                style={{ left: brush.x, top: brush.y, width: brush.width, height: brush.height }}
              />
            </li>
          )}
        </ul>
      )}
    </section>
  )
}

function StoryTableView({
  datasetId,
  table,
  rows,
}: {
  datasetId: string
  table: StoryTable
  rows: readonly StoryRow[]
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200">
      <table
        data-ak-block={`data-table:${table.id}:${datasetId}`}
        className="w-full border-collapse text-left text-sm"
      >
        <caption className="px-4 py-3 text-left text-sm font-semibold">{table.title}</caption>
        <thead className="bg-slate-50 text-xs text-slate-700">
          <tr>
            {table.columns.map((column) => (
              <th
                key={column.id}
                scope="col"
                className={`px-4 py-2 ${column.kind === 'number' ? 'text-right' : ''}`}
              >
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-t border-slate-100">
              {table.columns.map((column) => (
                <td
                  key={column.id}
                  className={`px-4 py-2 ${column.kind === 'number' ? 'text-right tabular-nums' : ''}`}
                >
                  {row.values.get(column.id)}
                </td>
              ))}
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={table.columns.length} className="px-4 py-3 text-slate-500">
                没有符合筛选条件的数据行。
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

function StoryDatasetView({
  dataset,
  source,
  version,
  onRendered,
  onRequestAnnotation,
}: {
  dataset: Dataset
  source: string
  version: number
  onRendered: () => void
  onRequestAnnotation?: Annotation
}) {
  const titleId = useId()
  const [group, setGroup] = useState('')
  const [query, setQuery] = useState('')
  const filterBy = dataset.filterBy
  const groups = useMemo(
    () =>
      filterBy
        ? Array.from(new Set(dataset.rows.map((row) => String(row.values.get(filterBy.id)))))
        : [],
    [dataset.rows, filterBy],
  )
  const groupValue = group.startsWith('filter:') ? group.slice(7) : undefined
  const matchingGroup =
    groupValue !== undefined && groups.includes(groupValue) ? groupValue : undefined
  const term = query.trim().toLowerCase()
  const rows = useMemo(() => {
    if (matchingGroup === undefined && !term) return dataset.rows
    return dataset.rows.filter((row) => {
      if (
        filterBy &&
        matchingGroup !== undefined &&
        row.values.get(filterBy.id) !== matchingGroup
      ) {
        return false
      }
      if (!term) return true
      for (const cell of row.values.values()) {
        if (String(cell).toLowerCase().includes(term)) return true
      }
      return false
    })
  }, [dataset.rows, filterBy, matchingGroup, term])
  // 筛选改变可见点集，旧选择不混入新批注；外壳也需要重算图钉位置。
  const view = JSON.stringify([matchingGroup, term])
  useDecisionRendered(source, version, onRendered, view)

  return (
    <section
      aria-labelledby={titleId}
      className="space-y-3"
      data-ak-block={`data-dataset:${dataset.id}`}
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id={titleId} className="text-lg font-semibold">
            {dataset.title}
          </h2>
          <output className="text-xs text-slate-500">
            显示 {rows.length} / {dataset.rows.length} 行
          </output>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {filterBy && (
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <span>{filterBy.label}</span>
              <select
                value={matchingGroup === undefined ? '' : `filter:${matchingGroup}`}
                className="rounded-md border border-slate-300 bg-white px-2 py-1"
                onChange={(event) => setGroup(event.currentTarget.value)}
              >
                <option value="">全部</option>
                {groups.map((value) => (
                  <option key={value} value={`filter:${value}`}>
                    {value || '（空白）'}
                  </option>
                ))}
              </select>
            </label>
          )}
          <input
            type="search"
            aria-label="筛选数据"
            placeholder="搜索数据"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            className="w-44 rounded-md border border-slate-300 px-2 py-1 text-sm"
          />
        </div>
      </div>
      {dataset.charts.map((chart) => (
        <StoryBars
          key={`${chart.id}:${view}`}
          dataset={dataset}
          chart={chart}
          rows={rows}
          onRequestAnnotation={onRequestAnnotation}
        />
      ))}
      {dataset.tables.map((table) => (
        <StoryTableView key={table.id} table={table} datasetId={dataset.id} rows={rows} />
      ))}
    </section>
  )
}

export function DataStoryRenderer({
  source,
  version,
  stateStore,
  onRendered,
  onRequestAnnotation,
}: RendererProps) {
  const parsed = useMemo(() => DATA_STORY_TEMPLATE.parse(source), [source])
  const state = useSyncExternalStore(
    stateStore.subscribe,
    stateStore.getSnapshot,
    stateStore.getSnapshot,
  )
  if (!parsed.ok) return <DecisionSourceError error={parsed.error} />
  const data = parsed.data
  const props = resolveEffectiveProps({ title: data.title }, state)
  return (
    <main data-ak-renderer="data-story" className="mx-auto max-w-5xl space-y-6 p-5">
      <header>
        <p className="text-xs font-semibold text-blue-700">数据分析</p>
        <h1 className="mt-1 text-2xl font-semibold">
          {typeof props.title === 'string' ? props.title : data.title}
        </h1>
        {data.summary && <p className="mt-2 text-sm text-slate-600">{data.summary}</p>}
      </header>
      {data.datasets.map((dataset) => (
        <StoryDatasetView
          key={dataset.id}
          dataset={dataset}
          source={source}
          version={version}
          onRendered={onRendered}
          onRequestAnnotation={onRequestAnnotation}
        />
      ))}
    </main>
  )
}
