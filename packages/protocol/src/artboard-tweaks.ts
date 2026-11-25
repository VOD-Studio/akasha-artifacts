import { z } from 'zod'
import { ArtboardColorSchema } from './artboard-appearance.js'

const MAX_TWEAKS = 32
const id = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/)
const token = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/)
const label = z.string().trim().min(1).max(120)
const localizedLabel = {
  /** 在没有匹配的语言标签时始终使用此文案。 */
  label,
  /** BCP 47 语言标签 → 文案，只影响界面，不参与出图。 */
  labels: z
    .record(z.string().regex(/^[a-z]{2,8}(?:-[a-z0-9]{1,8})*$/i), label)
    .refine((labels) => Object.keys(labels).length <= 24)
    .optional(),
}
const common = {
  ...localizedLabel,
  /** 画板内稳定且唯一；同时用作 `--akasha-tweak-<id>` 的后缀。 */
  id,
}
const tweak = z.discriminatedUnion('type', [
  z.object({
    ...common,
    /** 无单位数值；作者在 CSS 中按需选择单位。 */
    type: z.literal('number'),
    /** 最小可预览值，含边界。 */
    min: z.number(),
    /** 最大可预览值，含边界。 */
    max: z.number(),
    /** 同时用于首次预览、重置与该版本的导出。 */
    default: z.number(),
  }),
  z.object({
    ...common,
    /** 一组不含任意 CSS 表达式的稳定选项。 */
    type: z.literal('enum'),
    /** 默认选项的 `value`，不能填展示名称。 */
    default: token,
    /** 作者顺序决定选单顺序。 */
    options: z
      .array(z.object({ ...localizedLabel, /** 插入 CSS 变量的单个值。 */ value: token }))
      .min(1)
      .max(32),
  }),
  z.object({
    ...common,
    /** CSS 表示是 `1` 或 `0`。 */
    type: z.literal('boolean'),
    /** 初始开关值。 */
    default: z.boolean(),
  }),
  z.object({
    ...common,
    /** 六位 sRGB 十六进制颜色。 */
    type: z.literal('color'),
    /** 预览和固定版本的初始颜色。 */
    default: ArtboardColorSchema,
  }),
])
export type ArtboardTweak = z.infer<typeof tweak>

/** 每块画板独立声明；重复参数和越界默认值不能发布。 */
export const ArtboardTweaksSchema = z
  .array(tweak)
  .max(MAX_TWEAKS)
  .superRefine((fields, ctx) => {
    const ids = new Set<string>()
    for (const [index, field] of fields.entries()) {
      if (ids.has(field.id))
        ctx.addIssue({ code: 'custom', path: [index, 'id'], message: '画板参数标识不能重复' })
      ids.add(field.id)
      if (field.type === 'number' && !acceptsArtboardTweakValue(field, field.default))
        ctx.addIssue({ code: 'custom', path: [index, 'default'], message: '数值默认值须在范围内' })
      if (field.type !== 'enum') continue
      const options = new Set(field.options.map(({ value }) => value))
      if (!options.has(field.default))
        ctx.addIssue({ code: 'custom', path: [index, 'default'], message: '默认值须为已声明选项' })
      if (options.size !== field.options.length)
        ctx.addIssue({ code: 'custom', path: [index, 'options'], message: '参数选项值不能重复' })
    }
  })

/** 发送给单板沙盒的值，不含任意 CSS 字符串、表达式或 DOM 选择器。 */
export const ArtboardTweakValuesSchema = z
  .record(id, z.union([z.number(), z.boolean(), token, ArtboardColorSchema]))
  .refine((values) => Object.keys(values).length <= MAX_TWEAKS)
export type ArtboardTweakValues = z.infer<typeof ArtboardTweakValuesSchema>

type Value = ArtboardTweakValues[string]

/** 按画板自身声明校验值，不回退到默认值。 */
export function acceptsArtboardTweakValue(
  field: ArtboardTweak,
  value: Value | undefined,
): value is Value {
  switch (field.type) {
    case 'number':
      return typeof value === 'number' && value >= field.min && value <= field.max
    case 'enum':
      return field.options.some((option) => option.value === value)
    case 'boolean':
      return typeof value === 'boolean'
    case 'color':
      return ArtboardColorSchema.safeParse(value).success
  }
}

/** 未定义或不合法的覆写使用该板默认值；不输出别板或新版已移除的参数。 */
export function resolveArtboardTweaks(
  tweaks: readonly ArtboardTweak[],
  overrides?: ArtboardTweakValues,
): ArtboardTweakValues {
  const values: ArtboardTweakValues = {}
  for (const field of tweaks) {
    const override =
      overrides && Object.hasOwn(overrides, field.id) ? overrides[field.id] : undefined
    values[field.id] = acceptsArtboardTweakValue(field, override) ? override : field.default
  }
  return values
}
