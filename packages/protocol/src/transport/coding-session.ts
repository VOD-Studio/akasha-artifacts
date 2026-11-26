import { z } from 'zod'
import type { HandoffDesign } from '../handoff.js'
import { DesignSystemDraftSchema } from './design-system.js'
import { ArtifactHandoffReferenceSchema } from './mcp.js'

/** 会话 ID 可用于续接，不是访问凭证。 */
export const CodingSessionIdSchema = z.uuid()

/** 签入时由项目所有者指定固定设计，不能用实现端的后续参数替换。 */
export const CodingSessionConnectSchema = z.strictObject({
  label: z.string().trim().min(1).max(100),
  reference: ArtifactHandoffReferenceSchema,
})

/** 只交给签入客户端；正文与浏览器会话列表不包含 token。 */
export const CodingSessionGrantSchema = z.object({
  id: CodingSessionIdSchema,
  token: z.string().regex(/^[a-f0-9]{64}$/),
  expiresAt: z.iso.datetime(),
})

/** 组件源码只来自本项目已审阅的固定设计系统版本。 */
export interface CodingSessionRead {
  reference: z.infer<typeof ArtifactHandoffReferenceSchema>
  design: HandoffDesign
  components: { path: string; exportName: string; source: string }[]
}

const componentFiles = DesignSystemDraftSchema.shape.files.element.pick({
  path: true,
  content: true,
})
const componentInput = DesignSystemDraftSchema.shape.components.element
  .extend({
    files: z.array(componentFiles).min(1).max(128),
  })
  .refine(
    ({ files, path }) =>
      files.some((file) => file.path === path) &&
      new Set(files.map((file) => file.path)).size === files.length &&
      files.reduce((sum, file) => sum + file.content.length, 0) <= 6 * 1024 * 1024,
  )

/** 选完整制品源码或一组包含真实组件的文件；目标与基线只能由服务端从会话取得。 */
export const CodingSessionPublishSchema = z
  .strictObject({
    source: z
      .string()
      .min(1)
      .max(8 * 1024 * 1024)
      .optional(),
    component: componentInput.optional(),
  })
  .refine(({ source, component }) => (source === undefined) !== (component === undefined))
export type CodingSessionPublish = z.infer<typeof CodingSessionPublishSchema>

/** 只在不可变版本写入成功后返回，路径可在当前服务打开。 */
export interface CodingSessionPublication {
  artifactId: string
  version: number
  path: string
}
