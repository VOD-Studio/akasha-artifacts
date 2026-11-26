import { z } from 'zod'
import { DesignLayersSchema } from '../artboard/layers.js'
import { ElementRefSchema } from '../domain.js'
import type { HandoffDesign } from '../handoff.js'
import { ArtifactTypeSchema, PublicIdSchema } from '../primitives.js'
import { DesignSystemDraftSchema } from './design-system.js'
import { ArtifactHandoffReferenceSchema } from './mcp.js'

/** 会话 ID 可用于续接，不是访问凭证。 */
export const CodingSessionIdSchema = z.uuid()

/** 没有引用时由终端等待网页作者选择；一经绑定不可改指其他版本或作品。 */
export const CodingSessionConnectSchema = z.strictObject({
  label: z.string().trim().min(1).max(100),
  reference: ArtifactHandoffReferenceSchema.optional(),
})

/** 公开给项目所有者的目的地，不包含工作区路径、登录令牌或会话凭据。 */
export const CodingTargetSchema = z.object({
  id: CodingSessionIdSchema,
  label: z.string(),
  bound: z.boolean(),
})
export type CodingTarget = z.infer<typeof CodingTargetSchema>

/** 心跳回执不包含作品正文；绑定后再读取完整快照。 */
export const CodingSessionPollSchema = z.object({ bound: z.boolean() })

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

/** 不信任远端返回的源码描述或引用；两者必须对应同一个不可变版本。 */
export const CodingSessionReadSchema: z.ZodType<CodingSessionRead> = z
  .object({
    reference: ArtifactHandoffReferenceSchema,
    design: z.object({
      artifactId: PublicIdSchema,
      projectId: z.string(),
      type: ArtifactTypeSchema,
      slug: z.string(),
      version: z.number().int().positive(),
      title: z.string(),
      source: z.string(),
      note: z.string(),
      selection: z
        .object({
          pageId: z.string().optional(),
          boardId: z.string().optional(),
          element: ElementRefSchema.optional(),
        })
        .nullable(),
      structure: z.object({
        pages: z.array(
          z.object({ id: z.string(), title: z.string(), includeSharedBoards: z.boolean() }),
        ),
        boards: z.array(
          z.object({
            id: z.string(),
            title: z.string(),
            pageId: z.string().optional(),
            viewport: z.object({ width: z.number(), height: z.number() }).optional(),
            position: z.object({ x: z.number(), y: z.number() }).optional(),
            designLayers: DesignLayersSchema.optional(),
          }),
        ),
        flows: z.array(
          z.object({ from: z.string(), to: z.string(), label: z.string().optional() }),
        ),
      }),
    }),
    components: z.array(z.object({ path: z.string(), exportName: z.string(), source: z.string() })),
  })
  .refine(
    ({ design, reference }) =>
      design.artifactId === reference.artifactId &&
      design.projectId === reference.projectId &&
      design.version === reference.version,
  )

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
export const CodingSessionPublicationSchema = z
  .object({
    artifactId: PublicIdSchema,
    version: z.number().int().positive(),
    path: z.string(),
  })
  .refine((receipt) => receipt.path === `/a/${receipt.artifactId}/v/${receipt.version}`)
export type CodingSessionPublication = z.infer<typeof CodingSessionPublicationSchema>
