import { z } from 'zod'
import { ARTBOARD_GEOMETRY_LIMITS } from './artboard-layers.js'

/** 固定版式使用画板视口；只有流式版式接受纸型。 */
export const ArtboardPrintLayoutSchema = z.discriminatedUnion('mode', [
  z.strictObject({ mode: z.literal('fixed') }),
  z.strictObject({ mode: z.literal('flow'), paper: z.enum(['a4', 'letter']) }),
])
export type ArtboardPrintLayout = z.infer<typeof ArtboardPrintLayoutSchema>

/** 约束单板索引中的辅助线数量，不按页面或整份作品累计。 */
export const ARTBOARD_MAX_LAYOUT_GUIDES = 64

const guideSchema = z.strictObject({
  /** x 表示竖线，y 表示横线。 */
  axis: z.enum(['x', 'y']),
  /** 自画板左边或上边量起的固有 CSS 像素。 */
  position: z.number().min(0).max(ARTBOARD_GEOMETRY_LIMITS.viewport),
})
export type ArtboardLayoutGuide = z.infer<typeof guideSchema>

/** 同一轴线上的每个位置只能出现一次。 */
export const ArtboardLayoutGuidesSchema = z
  .array(guideSchema)
  .max(ARTBOARD_MAX_LAYOUT_GUIDES)
  .refine((guides) => {
    const seen = { x: new Set<number>(), y: new Set<number>() }
    for (const { axis, position } of guides) {
      if (seen[axis].has(position)) return false
      seen[axis].add(position)
    }
    return true
  }, '同轴辅助线的位置不能重复')

/** 以每英寸 96 个 CSS 像素换算整页尺寸；调用方只在分配位图时取整。 */
export function getArtboardPaperSize(paper: 'a4' | 'letter') {
  return paper === 'a4'
    ? { width: (210 * 96) / 25.4, height: (297 * 96) / 25.4 }
    : { width: 8.5 * 96, height: 11 * 96 }
}
