import type { ArtifactSpecOutput, ArtifactType, JsonPatchOp } from '@akasha/protocol'
import { Badge } from '@akasha/ui/badge'
import { Button } from '@akasha/ui/button'
import { Empty } from '@akasha/ui/empty'
import { RotateCcw, SlidersHorizontal } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { useArtifactSpecQuery, usePushArtifactStateMutation } from '../../entities/artifact/queries'

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
  // 允许测试或外层直接注入 schema，默认从服务端 GET /api/v1/specs/:type 获取
  specOverride?: ArtifactSpecOutput | null
  onPushPatch?: (patch: JsonPatchOp[]) => Promise<unknown>
  onFallbackToL1?: () => void
}

function escapeJsonPointer(token: string): string {
  return token.replace(/~/g, '~0').replace(/\//g, '~1')
}

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

// 构造针对 /props/<key> 的 RFC 6902 原子补丁：若状态快照尚未创建 /props 对象，则一次性初始化，避免路径缺失报错。
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

// L2 结构化属性面板：按 Kit 模板 schema 自动生成表单并通过 StateStream 零闪烁推送补丁；无 schema 时自动降级回 L1。
export function PropsPanel({
  artifactId,
  projectId,
  artifactType,
  source,
  stateSnapshot,
  specOverride,
  onPushPatch,
  onFallbackToL1,
}: PropsPanelProps) {
  const specQuery = useArtifactSpecQuery(artifactType, specOverride === undefined)
  const pushMutation = usePushArtifactStateMutation(artifactId)
  // 本地乐观草稿：避免文本输入或滑块拖动期间等待请求往返导致光标跳回
  const [optimisticValues, setOptimisticValues] = useState<Record<string, unknown>>({})

  useEffect(() => {
    void stateSnapshot
    setOptimisticValues({})
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

  const applyPatch = async (
    patch: JsonPatchOp[],
    optimisticKey?: string,
    optimisticVal?: unknown,
  ) => {
    if (optimisticKey !== undefined) {
      setOptimisticValues((prev) => ({ ...prev, [optimisticKey]: optimisticVal }))
    }
    try {
      if (onPushPatch) {
        await onPushPatch(patch)
      } else {
        await pushMutation.mutateAsync({ project: projectId, patch })
      }
    } catch (err) {
      if (optimisticKey !== undefined) {
        setOptimisticValues((prev) => {
          const next = { ...prev }
          delete next[optimisticKey]
          return next
        })
      }
      toast.error(err instanceof Error ? err.message : '推送属性补丁失败')
    }
  }

  if (fields.length === 0) {
    return (
      <div
        data-testid="props-panel-l1-fallback"
        className="space-y-3 rounded-xl border border-border bg-surface p-3"
      >
        <Empty
          variant="compact"
          title="已自动降级为 L1 评审"
          description={`类型「${artifactType}」不含结构化属性 Schema，请使用元素指认与批注表达修改意图。`}
        />
        {onFallbackToL1 ? (
          <div className="flex justify-center">
            <Button variant="outline" size="sm" onClick={onFallbackToL1}>
              返回 L1 批注
            </Button>
          </div>
        ) : null}
      </div>
    )
  }

  const hasOverrides = Object.keys(currentPropsOverlay).length > 0

  return (
    <div
      data-testid="props-panel"
      className="space-y-3 rounded-xl border border-border bg-surface p-3"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-ink">
          <SlidersHorizontal size={13} />
          <span>模板属性（L2）</span>
          <Badge tone="accent">{fields.length}</Badge>
        </div>
        {hasOverrides ? (
          <Button
            variant="ghost"
            size="sm"
            leftIcon={<RotateCcw size={11} />}
            loading={pushMutation.isPending}
            onClick={() => void applyPatch([{ op: 'add', path: '/props', value: {} }])}
          >
            重置
          </Button>
        ) : null}
      </div>

      <div className="space-y-3">
        {fields.map((field) => {
          const rawVal =
            optimisticValues[field.key] ??
            currentPropsOverlay[field.key] ??
            parsedSource?.[field.key] ??
            field.defaultValue
          const inputId = `ak-prop-${field.key}`

          if (field.type === 'boolean') {
            const checked = Boolean(rawVal)
            return (
              <label
                key={field.key}
                htmlFor={inputId}
                className="flex cursor-pointer items-center justify-between gap-2 rounded-lg border border-border px-2.5 py-2 text-xs"
              >
                <span className="font-medium text-ink">{field.label}</span>
                <input
                  id={inputId}
                  type="checkbox"
                  checked={checked}
                  onChange={(e) =>
                    void applyPatch(
                      buildPropPatch(stateSnapshot, field.key, e.target.checked),
                      field.key,
                      e.target.checked,
                    )
                  }
                  className="h-4 w-4 accent-violet-600"
                />
              </label>
            )
          }

          if (field.type === 'select' && field.options) {
            return (
              <div key={field.key} className="space-y-1">
                <label htmlFor={inputId} className="block text-[11px] font-medium text-ink-muted">
                  {field.label}
                </label>
                <select
                  id={inputId}
                  value={String(rawVal ?? field.options[0]?.value ?? '')}
                  onChange={(e) =>
                    void applyPatch(
                      buildPropPatch(stateSnapshot, field.key, e.target.value),
                      field.key,
                      e.target.value,
                    )
                  }
                  className="w-full rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs text-ink focus:border-accent focus:outline-none"
                >
                  {field.options.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            )
          }

          if (field.type === 'number') {
            const numVal = typeof rawVal === 'number' ? rawVal : Number(rawVal ?? field.min ?? 1)
            return (
              <div key={field.key} className="space-y-1">
                <div className="flex items-center justify-between text-[11px]">
                  <label htmlFor={inputId} className="font-medium text-ink-muted">
                    {field.label}
                  </label>
                  <span className="font-mono text-ink">{numVal}</span>
                </div>
                <input
                  id={inputId}
                  type="range"
                  min={field.min ?? 1}
                  max={field.max ?? 10}
                  step={field.step ?? 1}
                  value={numVal}
                  onChange={(e) => {
                    const nextNum = Number(e.target.value)
                    void applyPatch(
                      buildPropPatch(stateSnapshot, field.key, nextNum),
                      field.key,
                      nextNum,
                    )
                  }}
                  className="w-full accent-violet-600"
                />
              </div>
            )
          }

          return (
            <div key={field.key} className="space-y-1">
              <label htmlFor={inputId} className="block text-[11px] font-medium text-ink-muted">
                {field.label}
              </label>
              <input
                id={inputId}
                type="text"
                value={String(rawVal ?? '')}
                onChange={(e) =>
                  void applyPatch(
                    buildPropPatch(stateSnapshot, field.key, e.target.value),
                    field.key,
                    e.target.value,
                  )
                }
                className="w-full rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs text-ink focus:border-accent focus:outline-none"
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}
