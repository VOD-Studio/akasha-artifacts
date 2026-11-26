import { z } from 'zod'
import {
  DesignSystemDraftSchema,
  DesignSystemGenerateInputSchema,
  type DesignSystemReference,
  DesignSystemReferenceSchema,
  DesignSystemWriteOutputSchema,
} from './design-system.js'

/** 完整替换该固定版本的点名共享名单；空数组表示不向任何成员授权。 */
export const SystemMembersSchema = z.strictObject({
  logins: z.array(z.string().regex(/^[a-z0-9-]{1,39}$/i)).max(32),
})

/** 默认只能指向已发布的固定版本；撤回同时清除其默认资格。 */
export const SystemPublicationInputSchema = z.strictObject({
  action: z.enum(['publish', 'default', 'clear-default', 'withdraw']),
})
export type SystemPublicationAction = z.infer<typeof SystemPublicationInputSchema>['action']

/** 只暴露可选组件的标识与规范，不返回源文件、凭据、预览代码或其他项目的路径。 */
export const CatalogSystemSchema = DesignSystemReferenceSchema.omit({ sourceVersion: true }).extend(
  {
    title: z.string(),
    guidance: DesignSystemDraftSchema.shape.guidance,
    publication: z.enum(['private', 'team']),
    isDefault: z.boolean(),
  },
)
export type CatalogSystem = z.infer<typeof CatalogSystemSchema>

/** 只影响当前账号下次未显式选用系统的设计，不修改团队默认或其他人的偏好。 */
export const SystemPreferenceSchema = z.strictObject({ inheritDefault: z.boolean() })

/** 已筛选为当前 Hub 会话可在目标项目选用的固定版本。 */
export const SystemCatalogSchema = SystemPreferenceSchema.extend({
  items: z.array(CatalogSystemSchema),
})

/** 每套系统可选择一个已审阅入口或整个版本，绝不按同名导出跨系统寻址。 */
export const CatalogSelectionSchema = DesignSystemGenerateInputSchema.pick({
  id: true,
  version: true,
  component: true,
})
export type CatalogSelection = z.infer<typeof CatalogSelectionSchema>

/** 与审阅来源端点一致，限制整个 UTF-8 JSON 请求体，而不是文件字符数。 */
export const CATALOG_REQUEST_BYTES = 24 * 1024 * 1024

/** 省略 selections 才继承个人偏好；空数组显式创建不使用系统的设计。 */
export const CatalogPreviewInputSchema = DesignSystemGenerateInputSchema.pick({
  slug: true,
  title: true,
}).extend({
  selections: z
    .array(CatalogSelectionSchema)
    .max(8)
    .refine(
      (items) => new Set(items.map((item) => `${item.id}/${item.version}`)).size === items.length,
      '不能重复选用同一系统版本',
    )
    .optional(),
})

/** 不传候选源码时直接从固定内容起稿；提供候选时须先校验，再写不可变版本。 */
export const CatalogGenerateInputSchema = CatalogPreviewInputSchema.extend({
  candidateSource: z.string().max(CATALOG_REQUEST_BYTES).optional(),
})
export type CatalogGenerateInput = z.infer<typeof CatalogGenerateInputSchema>

const referencesSchema = z.array(DesignSystemReferenceSchema).max(8)
const prefix = '// @akasha/catalog-systems '

/** 来源只用于辨认与复核，不能作为工程源文件的读取授权。 */
export function catalogReferenceHeader(references: readonly DesignSystemReference[]): string {
  return (
    prefix +
    JSON.stringify(references).replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029')
  )
}

/** 只读成品首行，手工输入的不合法元数据不参与权限或选用决策。 */
export function readCatalogReferences(source: string): DesignSystemReference[] | null {
  if (!source.startsWith(prefix)) return null
  const end = source.indexOf('\n')
  if (end < 0 || end > 1024 * 1024) return null
  try {
    const parsed = referencesSchema.safeParse(JSON.parse(source.slice(prefix.length, end)))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

/** 基准只包含本次选用的已审阅产物，不创建版本，不授予原系统访问权限。 */
export const CatalogPreviewSchema = z.object({ source: z.string(), references: referencesSchema })

/** 修正定位到具体固定来源，组件修正还指明文件和导出，避免混淆同名按钮。 */
export const CatalogCorrectionSchema = z.object({
  kind: z.enum(['component', 'guidance']),
  ...DesignSystemReferenceSchema.pick({ id: true, version: true }).shape,
  component: DesignSystemGenerateInputSchema.shape.component,
})
export type CatalogCorrection = z.infer<typeof CatalogCorrectionSchema>

/** 无法安全区分作者修改和受管代码时，不生成版本；行号相对于原候选。 */
export const CatalogRecoverySchema = z.object({
  kind: z.literal('manual-review'),
  reason: z.enum(['structure', 'reference', 'instance']),
  line: z.number().int().positive(),
  references: referencesSchema,
  actions: z.tuple([z.literal('edit-source'), z.literal('regenerate')]),
})
export type CatalogRecovery = z.infer<typeof CatalogRecoverySchema>

/** 已写入独立版本的成品及其实际使用的固定来源。 */
export const CatalogGenerateOutputSchema = DesignSystemWriteOutputSchema.extend({
  references: referencesSchema,
  corrections: z.array(CatalogCorrectionSchema),
})
