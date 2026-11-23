import { z } from 'zod'

/** 实时事件与 Bridge 消息信封中 `v` 字段的取值；破坏性变更时递增。 */
export const PROTOCOL_VERSION = 1 as const

/** Artifact 类型全集；各取值的形态见行尾说明。 */
export const ARTIFACT_TYPES = [
  'react', // 单面可交互页面或参数调试台
  'html', // 自包含 HTML 片段或文档
  'markdown', // 只读展示，支持表格、代码块与 Mermaid 围栏
  'mermaid', // 纯 Mermaid 图表定义
  'svg', // 纯静态 SVG，禁止脚本与内联事件
  'artboard', // 并排多画板：多方案对比与分轮单选
  'document', // 结构化设计文档，段落带稳定块标识
  'verify', // 交付验收：预期与结果对比，逐条证据与裁决
  'pr-walkthrough', // 分章节代码走查与行级批注
  'live-timeline', // 任务进度看板，随 artifact_push_state 推进
  'option-compare', // 结构化方案对比矩阵
  'data-story', // 可筛选图表与表格，支持框选数据点批注
] as const

export const ArtifactTypeSchema = z.enum(ARTIFACT_TYPES)
export type ArtifactType = z.infer<typeof ArtifactTypeSchema>

/** Hub 可见性：`private` 仅项目所有者，`team` 成员可写，`public` 任何人可读。 */
export const VisibilitySchema = z.enum(['private', 'team', 'public'])
export type Visibility = z.infer<typeof VisibilitySchema>

/** 作者标识：`agent:<session>` 或 `human:<user>`。 */
export const AuthorSchema = z
  .string()
  .regex(/^(?:agent|human):[A-Za-z0-9._:@-]+$/, '作者格式须为 agent:<id> 或 human:<id>')
export type Author = z.infer<typeof AuthorSchema>

/** 对外 URL 使用的不可变公开 ID；生成器产出 21 位，解析兼容 16–32 位字母数字。 */
export const PublicIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9]{16,32}$/, 'publicId 须为 16–32 位字母或数字')
export type PublicId = z.infer<typeof PublicIdSchema>

/** 项目内可读别名：`<type>/<name>` 或单段 slug。 */
export const SlugSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9/_-]{0,127}$/, 'slug 须以小写字母或数字开头，仅含小写字母、数字、/、_、-')
export type Slug = z.infer<typeof SlugSchema>

/** ISO 8601 UTC 时间戳，以 `Z` 结尾。 */
export const ISODateTimeSchema = z.iso.datetime()
export type ISODateTime = z.infer<typeof ISODateTimeSchema>

/** RFC 6901 JSON Pointer：空串代表根，`~` 只可转义为 `~0` 或 `~1`。 */
export const JsonPointerSchema = z
  .string()
  .regex(/^(?:\/(?:[^/~]|~[01])*)*$/, 'path 须为合法的 RFC 6901 JSON Pointer')
export type JsonPointer = z.infer<typeof JsonPointerSchema>
