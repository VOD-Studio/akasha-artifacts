import { z } from 'zod'
import { DesignSystemDraftSchema, DesignSystemReferenceSchema } from './design-system.js'

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

/** 已筛选为当前 Hub 会话可在目标项目选用的固定版本。 */
export const SystemCatalogSchema = z.object({ items: z.array(CatalogSystemSchema) })
