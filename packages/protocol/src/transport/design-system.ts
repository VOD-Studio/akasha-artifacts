import { z } from 'zod'

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
})
export type DesignSystemPreviewOutput = z.infer<typeof DesignSystemPreviewOutputSchema>
