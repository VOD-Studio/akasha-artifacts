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
/** 原生图层内置调色板标识。 */
export const DESIGN_LAYER_COLORS = ['ink', 'blue', 'rose', 'amber', 'mint'] as const
export type DesignLayerPaletteColor = (typeof DESIGN_LAYER_COLORS)[number]

/** 原生图层内置调色板对应的前景与表面色（sRGB 十六进制）。 */
export const DESIGN_LAYER_PALETTE: Record<
  DesignLayerPaletteColor,
  { foreground: string; surface: string }
> = {
  ink: { foreground: '#202733', surface: '#dce2eb' },
  blue: { foreground: '#174f8f', surface: '#cfe6ff' },
  rose: { foreground: '#a02a45', surface: '#ffd7df' },
  amber: { foreground: '#71400f', surface: '#fff1b3' },
  mint: { foreground: '#146356', surface: '#cef6e8' },
}

/** 原生文字与便签图层可选的常用字号（CSS 像素）。 */
export const DESIGN_LAYER_FONT_SIZES = [12, 14, 16, 20, 24, 32] as const

/** 原生文字与便签图层可选的字重档位。 */
export const DESIGN_LAYER_FONT_WEIGHTS = ['normal', 'medium', 'semibold', 'bold'] as const
export type DesignLayerFontWeight = (typeof DESIGN_LAYER_FONT_WEIGHTS)[number]

/** 原生文字与便签图层可选的水平对齐方式。 */
export const DESIGN_LAYER_TEXT_ALIGNS = ['left', 'center', 'right'] as const
export type DesignLayerTextAlign = (typeof DESIGN_LAYER_TEXT_ALIGNS)[number]

/** 原生图层颜色：内置调色板标识或六位 sRGB 十六进制值，不接受任意 CSS 表达式。 */
export const DesignLayerColorSchema = z.union([
  z.enum(DESIGN_LAYER_COLORS),
  z.string().regex(/^#[\da-f]{6}$/i),
])
export type DesignLayerColor = z.infer<typeof DesignLayerColorSchema>

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
  // 内置调色板标记或六位 #RRGGBB 色值
  color: DesignLayerColorSchema.optional(),
  // 水平镜像翻转；缺省为未翻转
  flipX: z.literal(true).optional(),
  // 垂直镜像翻转；缺省为未翻转
  flipY: z.literal(true).optional(),
}

const typography = {
  // 固有视口下的字号，单位 CSS 像素；缺省为 16
  fontSize: z.number().int().min(10).max(128).optional(),
  // 字重档位；缺省为 normal
  fontWeight: z.enum(DESIGN_LAYER_FONT_WEIGHTS).optional(),
  // 水平对齐方式；缺省为 left
  textAlign: z.enum(DESIGN_LAYER_TEXT_ALIGNS).optional(),
}

/** 可独立变换的原生设计图层；声明式数据，不执行制品脚本。 */
export const DesignLayerSchema = z.discriminatedUnion('kind', [
  z.object({
    ...geometry,
    ...typography,
    // 无底色的设计文案；与网页节点的运行文字无关
    kind: z.literal('text'),
    // 原样显示换行，按纯文本渲染而不解释为 HTML
    text: z.string().max(8000),
  }),
  z.object({
    ...geometry,
    ...typography,
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

/**
 * 解析原生图层的前景、表面色与用于对比度计算的背景色。
 *
 * @remarks 内置调色板同时决定前景与表面；自定义十六进制色对文字/笔迹只改前景，对形状改填充。
 */
export function resolveDesignLayerColors(
  layer: Pick<DesignLayer, 'kind' | 'color'>,
  boardBackground = '#ffffff',
): { foreground: string; surface?: string; contrastBackground: string } {
  const defaultKey: DesignLayerPaletteColor = layer.kind === 'note' ? 'amber' : 'ink'
  const raw = layer.color ?? defaultKey
  if (raw in DESIGN_LAYER_PALETTE) {
    const swatch = DESIGN_LAYER_PALETTE[raw as DesignLayerPaletteColor]
    const surface = layer.kind === 'stroke' || layer.kind === 'text' ? undefined : swatch.surface
    return {
      foreground: swatch.foreground,
      surface,
      contrastBackground: layer.kind === 'note' ? swatch.surface : boardBackground,
    }
  }
  if (layer.kind === 'note') {
    const surface = DESIGN_LAYER_PALETTE.amber.surface
    return { foreground: raw, surface, contrastBackground: surface }
  }
  if (layer.kind === 'rectangle' || layer.kind === 'ellipse') {
    return { foreground: raw, surface: raw, contrastBackground: boardBackground }
  }
  return { foreground: raw, surface: undefined, contrastBackground: boardBackground }
}

/** 数组决定从下到上的顺序；重复 ID 不能作为稳定图层定位。 */
export const DesignLayersSchema = z
  .array(DesignLayerSchema)
  .max(96)
  .refine(
    (layers) => new Set(layers.map((layer) => layer.id)).size === layers.length,
    '画板图层标识不能重复',
  )
