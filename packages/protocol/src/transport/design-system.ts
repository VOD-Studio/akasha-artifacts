import { z } from 'zod'
import { ArtifactSchema, VersionSchema } from '../domain.js'
import { PublicIdSchema, SlugSchema } from '../primitives.js'

// 路径只是所选文件集合内的键，绝不作为宿主路径或 URL 解析。
const selectedPath = z
  .string()
  .min(1)
  .max(512)
  .refine((path) =>
    path
      .split('/')
      .every(
        (part) =>
          part &&
          !part.startsWith('.') &&
          part !== 'node_modules' &&
          !/[\\:#?%]/.test(part) &&
          Array.from(part).every((c) => c.charCodeAt(0) >= 32),
      ),
  )
const component = z.object({
  // 始终相对用户所选目录；同一路径可审阅多个具名导出。
  path: selectedPath.regex(/\.[jt]sx?$/i),
  exportName: z.string().regex(/^(?:default|[$A-Z_a-z][$\w]*)$/),
})
const file = z.object({
  path: selectedPath,
  kind: z.enum(['source', 'logo', 'font', 'guidelines', 'figma']),
  // 源码、规范和 Figma 链接为文本；Logo、字体及 .fig 文件为无前缀的 base64。
  content: z
    .string()
    .min(1)
    .max(2 * 1024 * 1024),
})
const propValue = z.union([z.string().max(8192), z.boolean(), z.number()])
const componentKey = ({ path, exportName }: z.infer<typeof component>) =>
  `component:${path}#${exportName}`

/** 审阅草案仅包含用户选定的内容；来源标记不授予任何抓取权限。 */
export const DesignSystemDraftSchema = z
  .object({
    // 供审阅者辨识来源，不是宿主文件路径、仓库凭据或远端读取许可。
    origin: z.object({
      kind: z.enum(['local', 'github-checkout']),
      label: z.string().trim().min(1).max(512),
    }),
    // 构建可读取的完整集合，未勾选的依赖不从宿主补齐。
    files: z.array(file).min(1).max(128),
    // 所选的导出与示例 props 按此顺序预览、记入快照。
    components: z
      .array(component.extend({ props: z.record(z.string().max(128), propValue) }))
      .max(32),
    guidance: z.object({
      // 人工补充的使用约束，不因重新选择组件源码而丢失。
      instructions: z.string().max(32768),
      fontFamily: z.string().max(256),
      color: z.string().regex(/^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i),
      // 画板布局的间距和内边距，单位为 CSS 像素。
      spacing: z.number().min(0).max(512),
    }),
  })
  .superRefine((draft, ctx) => {
    const paths = new Set(draft.files.map(({ path }) => path))
    if (
      paths.size !== draft.files.length ||
      new Set(draft.components.map(componentKey)).size !== draft.components.length
    )
      ctx.addIssue({ code: 'custom', message: '文件与组件标识不得重复' })
    if (draft.files.reduce((total, item) => total + item.content.length, 0) > 6 * 1024 * 1024)
      ctx.addIssue({ code: 'custom', message: '来源内容总量超出上限' })
    const sourcePaths = new Set(
      draft.files.filter((item) => item.kind === 'source').map((item) => item.path),
    )
    if (
      draft.components.some((entry) => !sourcePaths.has(entry.path)) ||
      (sourcePaths.size > 0 && !draft.components.length)
    )
      ctx.addIssue({ code: 'custom', message: '请选择授权源码中的组件入口' })
  })
export type DesignSystemDraft = z.infer<typeof DesignSystemDraftSchema>

/** 缺失文件和缺失导出是不同决定；调用方必须逐项确认。 */
export function removedDesignSystemItems(
  previous: DesignSystemDraft,
  next: DesignSystemDraft,
): string[] {
  const keys = (draft: DesignSystemDraft) => [
    ...draft.files.map(({ path }) => `file:${path}`),
    ...draft.components.map(componentKey),
  ]
  const retained = new Set(keys(next))
  return keys(previous).filter((key) => !retained.has(key))
}

/** 构建许可只对这一份随请求发送的文件生效。 */
export const DesignSystemPreviewInputSchema = z.object({
  draft: DesignSystemDraftSchema,
  buildApproved: z.boolean(),
})
export type DesignSystemPreviewInput = z.infer<typeof DesignSystemPreviewInputSchema>

/** 预览输出是交给隔离沙盒的 React 源码，不在工作台执行。 */
export const DesignSystemPreviewOutputSchema = z.object({
  // 来源标签与所选文件的 SHA-256，不是制品的数字版本号。
  sourceVersion: z.string().regex(/^[a-f0-9]{64}$/),
  previewSource: z.string(),
  // 绑定同项目、完整草稿和本次构建结果的临时凭证；不能复用于其他草稿。
  reviewToken: z.string().regex(/^[a-f0-9]{64}$/),
})
export type DesignSystemPreviewOutput = z.infer<typeof DesignSystemPreviewOutputSchema>

/** 系统版本固定所选输入与构建结果；生成时不再触碰来源或重新构建。 */
export const DesignSystemSnapshotSchema = DesignSystemPreviewOutputSchema.omit({
  reviewToken: true,
})
  .extend({
    draft: DesignSystemDraftSchema,
    // 固定预览源码中的 UTF-16 区间。生成单组件时只复制选定的闭包，不运行其余组件的模块代码。
    compiledRanges: z
      .array(z.tuple([z.number().int().nonnegative(), z.number().int().positive()]))
      .max(32),
  })
  .refine(
    (s) =>
      s.compiledRanges.length === s.draft.components.length &&
      s.compiledRanges.every(
        ([a, b], i, ranges) =>
          a < b && b <= s.previewSource.length && (!i || a >= ranges[i - 1][1]),
      ),
  )
export type DesignSystemSnapshot = z.infer<typeof DesignSystemSnapshotSchema>

/** 首发不传标识和基线，重同步必须同时提交两者。 */
export const DesignSystemPublishInputSchema = DesignSystemPreviewInputSchema.extend({
  reviewToken: DesignSystemPreviewOutputSchema.shape.reviewToken,
  slug: SlugSchema,
  title: z.string().trim().min(1).max(512),
  id: PublicIdSchema.optional(),
  baseVersion: z.number().int().positive().optional(),
  // 必须与相对基线缺失的文件／导出键集合一致，空数组不表示同意全部。
  confirmedRemovals: z.array(z.string().max(800)).max(160),
}).refine(
  (v) => (v.id === undefined) === (v.baseVersion === undefined),
  '重同步必须同时提供 id 与 baseVersion',
)
export type DesignSystemPublishInput = z.infer<typeof DesignSystemPublishInputSchema>

/** 从同项目的指定固定版本创建新的、独立的单画板设计。 */
export const DesignSystemGenerateInputSchema = z.object({
  id: PublicIdSchema,
  version: z.number().int().positive(),
  slug: SlugSchema,
  title: z.string().trim().min(1).max(512),
  // 未选择单个组件时生成完整系统示例；不读取头版本。
  component: component.optional(),
})
export type DesignSystemGenerateInput = z.infer<typeof DesignSystemGenerateInputSchema>

/** 返回已提交的制品及其不可变源码，而非构建任务。 */
export const DesignSystemWriteOutputSchema = z.object({
  artifact: ArtifactSchema,
  version: VersionSchema,
})
export type DesignSystemWriteOutput = z.infer<typeof DesignSystemWriteOutputSchema>

const referenceSchema = z.object({
  id: PublicIdSchema,
  version: z.number().int().positive(),
  sourceVersion: DesignSystemPreviewOutputSchema.shape.sourceVersion,
  components: z.array(component).max(32),
})
/** 生成时使用的固定来源；写在生成稿源码中，不授予打开系统的权限。 */
export type DesignSystemReference = z.infer<typeof referenceSchema>
const referencePrefix = '// @akasha/design-system '

/** 移除 JSON 中的 JS 行分隔符，保持可直接嵌入独立源码首行。 */
export function designSystemReferenceHeader(reference: DesignSystemReference): string {
  return (
    referencePrefix +
    JSON.stringify(reference).replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029')
  )
}

/** 仅检查首行；普通 React 源码、手改无效的标记都没有可导航的固定来源。 */
export function readDesignSystemReference(source: string): DesignSystemReference | null {
  if (!source.startsWith(referencePrefix)) return null
  const end = source.indexOf('\n')
  if (end < 0 || end > 64 * 1024) return null
  try {
    const parsed = referenceSchema.safeParse(JSON.parse(source.slice(referencePrefix.length, end)))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}
