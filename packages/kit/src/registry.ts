import type { ArtifactType, CheckDiagnostic } from '@akasha/protocol'

export type KitPropControlType = 'string' | 'boolean' | 'number' | 'select'

export interface KitPropOption {
  value: string
  label: string
}

/** 属性面板上的一个控件，同时是 props schema 里一个字段的定义。 */
export interface KitPropField {
  /** 对应源码 JSON 里的字段名。 */
  key: string
  /** 属性面板上显示的名称。 */
  label: string
  type: KitPropControlType
  /** 字段说明，进入 JSON Schema。 */
  description?: string
  defaultValue?: string | number | boolean
  /** 数值范围与步长；仅 `number` 类型使用。 */
  min?: number
  max?: number
  step?: number
  /** 候选项；仅 `select` 类型使用。 */
  options?: readonly KitPropOption[]
}

export type KitParseResult<T> = { ok: true; data: T } | { ok: false; error: string }

/** 一个 Kit 模板：写作规范、props 定义、源码解析与校验的单一事实源。 */
export interface KitTemplateDefinition<TData = unknown> {
  /** 注册键，同时是该模板对应的 Artifact 类型。 */
  type: ArtifactType
  title: string
  description: string
  /** 按需写作规范，经 `artifact_spec` 返回给 Agent。 */
  guide: string
  /** 最小示例源码。 */
  example: string
  /** 属性面板的字段定义；同时写入 `propsSchema` 的 `x-akasha-props`。 */
  propFields: readonly KitPropField[]
  /** props 的 JSON Schema，由 `buildPropsJsonSchema` 从 `propFields` 生成。 */
  propsSchema: Record<string, unknown>
  /** 把模板源码解析成强类型数据；失败时把原因放进结果，不向外抛。 */
  parse: (source: string) => KitParseResult<TData>
  /** 模板专属的静态校验，与 `CheckService` 的通用规则叠加。 */
  validate: (source: string) => CheckDiagnostic[]
}

const templateRegistry = new Map<ArtifactType, KitTemplateDefinition<unknown>>()

/** 注册模板；同一类型后注册的覆盖先注册的。 */
export function registerKitTemplate<TData>(def: KitTemplateDefinition<TData>): void {
  templateRegistry.set(def.type, def as KitTemplateDefinition<unknown>)
}

export function getKitTemplate<TData = unknown>(
  type: ArtifactType,
): KitTemplateDefinition<TData> | undefined {
  return templateRegistry.get(type) as KitTemplateDefinition<TData> | undefined
}

export function listKitTemplates(): readonly KitTemplateDefinition<unknown>[] {
  return Array.from(templateRegistry.values())
}

/**
 * 合并源码里的初始属性与运行时状态流（`state.props`）里的覆盖值。
 *
 * @remarks 状态流里没有 `props`，或它不是对象时，原样返回 `baseProps`。
 */
export function resolveEffectiveProps<T extends Record<string, unknown>>(
  baseProps: T,
  stateSnapshot: Record<string, unknown> | undefined,
): T {
  const rawOverlay = stateSnapshot?.props
  if (!rawOverlay || typeof rawOverlay !== 'object' || Array.isArray(rawOverlay)) {
    return baseProps
  }
  return {
    ...baseProps,
    ...(rawOverlay as Partial<T>),
  }
}

/** 由属性字段定义生成 props 的 JSON Schema；`select` 类型映射为带 `enum` 的字符串。 */
export function buildPropsJsonSchema(
  required: readonly string[],
  extraProperties: Record<string, unknown>,
  propFields: readonly KitPropField[],
): Record<string, unknown> {
  const properties: Record<string, unknown> = { ...extraProperties }
  for (const field of propFields) {
    properties[field.key] = {
      type: field.type === 'select' ? 'string' : field.type,
      title: field.label,
      ...(field.description ? { description: field.description } : {}),
      ...(field.defaultValue !== undefined ? { default: field.defaultValue } : {}),
      ...(field.min !== undefined ? { minimum: field.min } : {}),
      ...(field.max !== undefined ? { maximum: field.max } : {}),
      ...(field.options ? { enum: field.options.map((o) => o.value) } : {}),
    }
  }
  return {
    type: 'object',
    required: [...required],
    properties,
    'x-akasha-props': propFields,
  }
}
