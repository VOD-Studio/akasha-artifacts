import type { ArtifactType, CheckDiagnostic } from '@akasha/protocol'

export type KitPropControlType = 'string' | 'boolean' | 'number' | 'select'

export interface KitPropOption {
  value: string
  label: string
}

export interface KitPropField {
  key: string
  label: string
  type: KitPropControlType
  description?: string
  defaultValue?: string | number | boolean
  min?: number
  max?: number
  step?: number
  options?: readonly KitPropOption[]
}

export type KitParseResult<T> = { ok: true; data: T } | { ok: false; error: string }

export interface KitTemplateDefinition<TData = unknown> {
  type: ArtifactType
  title: string
  description: string
  guide: string
  example: string
  propFields: readonly KitPropField[]
  propsSchema: Record<string, unknown>
  parse: (source: string) => KitParseResult<TData>
  validate: (source: string) => CheckDiagnostic[]
}

const templateRegistry = new Map<ArtifactType, KitTemplateDefinition<unknown>>()

// 模板注册中心：将模板的 props schema、静态校验规则与按需写作规范收口为一处事实源。
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

// 合并源码中的初始属性与运行时 StateStream（state.props.*）覆盖值，供沙盒 L2 实时无闪烁生效。
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
