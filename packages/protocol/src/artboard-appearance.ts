import { z } from 'zod'
import { ARTBOARD_GEOMETRY_LIMITS } from './artboard-layers.js'

/** 画板颜色使用六位 sRGB 十六进制，不接受任意 CSS 值。 */
export const ArtboardColorSchema = z.string().regex(/^#[\da-f]{6}$/i)

/** 画板底色位于作者内容下方；圆角不改变固有视口或画布坐标。 */
export const ArtboardAppearanceSchema = z.object({
  /** 未声明时使用白色底色。 */
  background: ArtboardColorSchema.optional(),
  /** 单位为固有 CSS 像素；未声明时为直角。 */
  cornerRadius: z.number().int().min(0).max(ARTBOARD_GEOMETRY_LIMITS.viewport).optional(),
})
export type ArtboardAppearance = z.infer<typeof ArtboardAppearanceSchema>

/** 没有外观声明的旧画板保留白底与直角。 */
export const DEFAULT_ARTBOARD_APPEARANCE = { background: '#ffffff', cornerRadius: 0 } as const
