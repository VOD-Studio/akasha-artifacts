import { z } from 'zod'

/** 画板视口和布局坐标在作者、外壳与沙盒之间采用相同约束。 */
export const ARTBOARD_GEOMETRY_LIMITS = { coordinate: 1_000_000, viewport: 8192 } as const

/** 原生图层用稳定块标识关联批注，不依赖沙盒结构路径。 */
export const DESIGN_LAYER_BLOCK_PREFIX = 'design-layer:'

const layerId = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$/)
const coordinate = z
  .number()
  .min(-ARTBOARD_GEOMETRY_LIMITS.coordinate)
  .max(ARTBOARD_GEOMETRY_LIMITS.coordinate)
const dimension = z.number().int().min(1).max(ARTBOARD_GEOMETRY_LIMITS.viewport)
const style = z.enum(['ink', 'blue', 'rose', 'amber', 'mint'])
const unitPoint = z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)])
const geometry = {
  // 只要求在该画板内唯一；该 ID 不随位置、尺寸和文本改动变化
  id: layerId,
  // 相对画板左上角的 CSS 像素坐标，允许部分在画板之外
  x: coordinate,
  y: coordinate,
  // 画板在固有视口下的边界尺寸，不含外壳缩放
  width: dimension,
  height: dimension,
  // 同一画板中以相同标识选择、移动和解组；与其他画板无关
  layoutGroup: layerId.optional(),
  // 内置调色板标记，不接受任意 CSS 值
  color: style.optional(),
}

/** 可独立变换的原生设计图层；声明式数据，不执行制品脚本。 */
export const DesignLayerSchema = z.discriminatedUnion('kind', [
  z.object({
    ...geometry,
    // 无底色的设计文案；与网页节点的运行文字无关
    kind: z.literal('text'),
    // 原样显示换行，按纯文本渲染而不解释为 HTML
    text: z.string().max(8000),
  }),
  z.object({
    ...geometry,
    // 带底色和内边距的说明，不生成批注线程或 Agent 反馈
    kind: z.literal('note'),
    // 便签的纯文本正文；允许空白便签
    text: z.string().max(8000),
  }),
  z.object({
    ...geometry,
    // 直角实心形状，以几何边界决定尺寸
    kind: z.literal('rectangle'),
  }),
  z.object({
    ...geometry,
    // 在矩形边界内作内切椭圆；宽高相等时为正圆
    kind: z.literal('ellipse'),
  }),
  z.object({
    ...geometry,
    // 按采样顺序连接的开放笔迹，不填充轮廓
    kind: z.literal('stroke'),
    // 在自己的包围盒中归一化到 0–1，移动、缩放不改笔迹采样
    points: z.array(unitPoint).min(2).max(2048),
  }),
])
export type DesignLayer = z.infer<typeof DesignLayerSchema>

/** 数组决定从下到上的顺序；重复 ID 不能作为稳定图层定位。 */
export const DesignLayersSchema = z
  .array(DesignLayerSchema)
  .max(96)
  .refine(
    (layers) => new Set(layers.map((layer) => layer.id)).size === layers.length,
    '画板图层标识不能重复',
  )
