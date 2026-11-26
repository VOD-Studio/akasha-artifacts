import { z } from 'zod'
import type { HandoffDesign } from '../handoff.js'
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
