import type { ArtifactSpecOutput, ArtifactType, JsonPatchOp } from '@akasha/protocol'
import { Button } from '@akasha/ui/button'
import { Empty } from '@akasha/ui/empty'
import { Input } from '@akasha/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@akasha/ui/select'
import { Skeleton } from '@akasha/ui/skeleton'
import { Slider } from '@akasha/ui/slider'
import { Switch } from '@akasha/ui/switch'
import { RotateCcw, SlidersHorizontal } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { useArtifactSpecQuery, usePushArtifactStateMutation } from '@/entities/artifact'
import { isAccessDenied } from '@/shared/api/error'
import { useMessages } from '@/shared/i18n'
import { applyJsonPatchClient } from '@/shared/lib/json-patch'
import { panelMessages } from './messages'

export interface PropsPanelField {
  key: string
  label: string
  type: 'string' | 'boolean' | 'number' | 'select'
  description?: string
  defaultValue?: string | number | boolean
  min?: number
  max?: number
  step?: number
  options?: Array<{ value: string; label: string }>
}

export interface PropsPanelProps {
  artifactId: string
  projectId: string
  artifactType: ArtifactType
  source: string
  stateSnapshot: Record<string, unknown>
  /** 历史快照只展示声明的值，不允许改写当前状态流。 */
  readOnly?: boolean
  // 允许测试或外层直接注入 schema，默认从服务端 GET /api/v1/specs/:type 获取
  specOverride?: ArtifactSpecOutput | null
  onPushPatch?: (patch: JsonPatchOp[]) => Promise<unknown>
  onFallbackToL1?: () => void
}

function escapeJsonPointer(token: string): string {
  return token.replace(/~/g, '~0').replace(/\//g, '~1')
}

/** 从制品写作规范的 `x-akasha-props` 里取出属性面板的字段；类型不合法的字段被跳过。 */
export function extractPropFieldsFromSpec(spec?: ArtifactSpecOutput | null): PropsPanelField[] {
  const rawSchema = spec?.schema
  if (!rawSchema || typeof rawSchema !== 'object') return []
  const rawFields = (rawSchema as Record<string, unknown>)['x-akasha-props']
  if (!Array.isArray(rawFields)) return []
  const fields: PropsPanelField[] = []
  for (const item of rawFields) {
    if (!item || typeof item !== 'object') continue
    const rec = item as Record<string, unknown>
    const key = typeof rec.key === 'string' ? rec.key : ''
    const label = typeof rec.label === 'string' ? rec.label : key
    const type = rec.type
    if (
      !key ||
      (type !== 'string' && type !== 'boolean' && type !== 'number' && type !== 'select')
    ) {
      continue
    }
    fields.push({
      key,
      label,
      type,
      description: typeof rec.description === 'string' ? rec.description : undefined,
      defaultValue:
        typeof rec.defaultValue === 'string' ||
        typeof rec.defaultValue === 'number' ||
        typeof rec.defaultValue === 'boolean'
          ? rec.defaultValue
          : undefined,
      min: typeof rec.min === 'number' ? rec.min : undefined,
      max: typeof rec.max === 'number' ? rec.max : undefined,
      step: typeof rec.step === 'number' ? rec.step : undefined,
      options: Array.isArray(rec.options)
        ? rec.options.filter(
            (o): o is { value: string; label: string } =>
              Boolean(o) &&
              typeof o === 'object' &&
              typeof (o as { value?: unknown }).value === 'string' &&
              typeof (o as { label?: unknown }).label === 'string',
          )
        : undefined,
    })
  }
  return fields
}

/**
 * 构造把 `/props/<key>` 设为 `value` 的补丁。
 *
 * @remarks 状态快照里还没有 `props` 对象时，用一条操作整体初始化，避免路径缺失报错。
 */
export function buildPropPatch(
  stateSnapshot: Record<string, unknown>,
  key: string,
  value: unknown,
): JsonPatchOp[] {
  const existingProps = stateSnapshot.props
  if (!existingProps || typeof existingProps !== 'object' || Array.isArray(existingProps)) {
    return [{ op: 'add', path: '/props', value: { [key]: value } }]
  }
  return [{ op: 'add', path: `/props/${escapeJsonPointer(key)}`, value }]
}

function PropertyField({
  field,
  rawValue,
  readOnly,
  onChange,
}: {
  field: PropsPanelField
  rawValue: unknown
  readOnly: boolean
  onChange: (value: string | boolean | number) => void
}) {
  const { number } = useMessages(panelMessages)
  const id = `ak-prop-${field.key}`

  if (field.type === 'boolean') {
    return (
      <div className="flex items-center justify-between gap-3 py-0.5">
        <label htmlFor={id} className="min-w-0 cursor-pointer text-xs text-ink">
          {field.label}
        </label>
        <Switch
          id={id}
          size="sm"
          checked={Boolean(rawValue)}
          disabled={readOnly}
          onCheckedChange={(checked) => onChange(checked === true)}
        />
      </div>
    )
  }

  if (field.type === 'select' && field.options) {
    const rawSelection = String(rawValue ?? field.options[0]?.value ?? '')
    const selection =
      field.options.find((option) => option.value === rawSelection) ?? field.options[0]
    // Select 保留空串表示未选择，Schema 的选项值则可能是空串。
    return (
      <div className="grid grid-cols-[minmax(0,1fr)_8.5rem] items-center gap-2">
        <label htmlFor={id} className="truncate text-xs text-ink">
          {field.label}
        </label>
        <Select
          id={id}
          disabled={readOnly}
          value={selection ? `option:${selection.value}` : ''}
          onValueChange={(value) => onChange(value.slice('option:'.length))}
        >
          <SelectTrigger aria-label={field.label} controlSize="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {field.options.map((option) => (
              <SelectItem key={option.value} value={`option:${option.value}`}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    )
  }

  if (field.type === 'number') {
    const value = typeof rawValue === 'number' ? rawValue : Number(rawValue ?? field.min ?? 1)
    return (
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className="truncate text-ink">{field.label}</span>
          <span dir="ltr" className="font-mono text-[11px] tabular-nums text-ink-muted">
            {number(value)}
          </span>
        </div>
        <Slider
          id={id}
          aria-label={field.label}
          min={field.min ?? 1}
          max={field.max ?? 10}
          step={field.step ?? 1}
          value={[value]}
          disabled={readOnly}
          onValueChange={([next]) => onChange(next)}
        />
      </div>
    )
  }

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_8.5rem] items-center gap-2">
      <label htmlFor={id} className="truncate text-xs text-ink">
        {field.label}
      </label>
      <Input
        id={id}
        controlSize="sm"
        value={String(rawValue ?? '')}
        disabled={readOnly}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  )
}

/**
 * L2 结构化属性面板：按 Kit 模板的 schema 自动生成表单，改动以补丁推送到状态流。
 *
 * @remarks 没有 schema 时不显示属性面板。
 */
export function PropsPanel({
  artifactId,
  projectId,
  artifactType,
  source,
  stateSnapshot,
  readOnly = false,
  specOverride,
  onPushPatch,
  onFallbackToL1,
}: PropsPanelProps) {
  const { t } = useMessages(panelMessages)
  const specQuery = useArtifactSpecQuery(artifactType, specOverride === undefined)
  // 同一队列中已排队的参数写入也必须遵守刚返回的权限拒绝。
  const deniedArtifact = useRef<string | null>(null)
  const [denied, setDenied] = useState<string | null>(null)
  const writable = !readOnly && denied !== artifactId
  const pushMutation = usePushArtifactStateMutation(artifactId)
  // 本地乐观草稿：避免文本输入或滑块拖动期间等待请求往返导致光标跳回
  const [optimisticValues, setOptimisticValues] = useState<Record<string, unknown>>({})
  // 串行化提交队列与最新快照引用：连续修改多个属性时，前一条 /props 初始化完成后下一条再构造子路径补丁，避免覆盖先前编辑。
  const latestSnapshotRef = useRef<Record<string, unknown>>(stateSnapshot)
  const pendingQueueRef = useRef<Promise<void>>(Promise.resolve())
  const inFlightCountRef = useRef(0)

  useEffect(() => {
    latestSnapshotRef.current = stateSnapshot
    if (inFlightCountRef.current === 0) {
      setOptimisticValues({})
    }
  }, [stateSnapshot])

  const spec = specOverride !== undefined ? specOverride : specQuery.data
  const fields = useMemo(() => extractPropFieldsFromSpec(spec), [spec])

  const parsedSource = useMemo(() => {
    if (!source.trim().startsWith('{')) return null
    try {
      const parsed = JSON.parse(source) as unknown
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null
    } catch {
      return null
    }
  }, [source])

  const currentPropsOverlay = useMemo(() => {
    const raw = stateSnapshot.props
    return raw && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {}
  }, [stateSnapshot])

  const enqueuePropUpdate = (
    buildOps: (snapshot: Record<string, unknown>) => JsonPatchOp[],
    optimisticKey?: string,
    optimisticVal?: unknown,
  ) => {
    if (!writable || deniedArtifact.current === artifactId) return
    if (optimisticKey !== undefined) {
      setOptimisticValues((prev) => ({ ...prev, [optimisticKey]: optimisticVal }))
    }
    inFlightCountRef.current += 1
    pendingQueueRef.current = pendingQueueRef.current
      .catch(() => {})
      .then(async () => {
        try {
          if (deniedArtifact.current === artifactId) return
          const patch = buildOps(latestSnapshotRef.current)
          if (onPushPatch) {
            await onPushPatch(patch)
          } else {
            await pushMutation.mutateAsync({ project: projectId, patch })
          }
          latestSnapshotRef.current = applyJsonPatchClient(latestSnapshotRef.current, patch)
        } catch (err) {
          if (isAccessDenied(err)) {
            if (deniedArtifact.current !== artifactId) {
              toast.error(t('没有编辑权限'))
            }
            deniedArtifact.current = artifactId
            setDenied(artifactId)
            setOptimisticValues({})
          } else if (optimisticKey !== undefined) {
            setOptimisticValues((prev) => {
              const next = { ...prev }
              delete next[optimisticKey]
              return next
            })
          }
          if (!isAccessDenied(err))
            toast.error(err instanceof Error ? err.message : t('无法更新运行参数'))
        } finally {
          inFlightCountRef.current = Math.max(0, inFlightCountRef.current - 1)
        }
      })
  }

  if (specOverride === undefined && specQuery.isPending) {
    return (
      <section aria-label={t('运行参数')} aria-busy="true">
        <Skeleton className="h-24 w-full" />
      </section>
    )
  }

  if (fields.length === 0) {
    return (
      <div
        data-testid="props-panel-l1-fallback"
        className="space-y-3 rounded-xl border border-border bg-surface p-3"
      >
        <Empty
          variant="compact"
          title={specQuery.isError ? t('无法加载运行参数') : t('没有可调整的参数')}
        />
        {onFallbackToL1 ? (
          <div className="flex justify-center">
            <Button variant="outline" size="sm" onClick={onFallbackToL1}>
              {t('打开批注')}
            </Button>
          </div>
        ) : null}
      </div>
    )
  }

  const hasOverrides = Object.keys(currentPropsOverlay).length > 0

  return (
    <fieldset disabled={!writable} data-testid="props-panel" className="min-w-0 space-y-2.5">
      <legend className="sr-only">{t('运行参数')}</legend>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-ink-muted uppercase">
          <SlidersHorizontal size={12} aria-hidden />
          <span aria-hidden>{t('运行参数')}</span>
        </div>
        {writable && hasOverrides ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-1.5 text-[11px]"
            leftIcon={<RotateCcw size={11} />}
            loading={pushMutation.isPending}
            onClick={() => {
              setOptimisticValues({})
              enqueuePropUpdate(() => [{ op: 'add', path: '/props', value: {} }])
            }}
          >
            {t('重置')}
          </Button>
        ) : null}
      </div>

      <div className="space-y-2.5">
        {fields.map((field) => {
          const rawValue =
            optimisticValues[field.key] ??
            currentPropsOverlay[field.key] ??
            parsedSource?.[field.key] ??
            field.defaultValue
          const updateValue = (value: string | boolean | number) => {
            enqueuePropUpdate(
              (snapshot) => buildPropPatch(snapshot, field.key, value),
              field.key,
              value,
            )
          }
          return (
            <PropertyField
              key={field.key}
              field={field}
              rawValue={rawValue}
              readOnly={!writable}
              onChange={updateValue}
            />
          )
        })}
      </div>
    </fieldset>
  )
}
