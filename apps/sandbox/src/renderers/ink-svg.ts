import { gpen, styles } from '@violetjs/inkline'
import { inkSvg } from '@violetjs/inkline/dom'

export function tryInkSvg(svgEl: SVGSVGElement | null, seed = 1): void {
  if (!svgEl) return
  // inkSvg 依赖真实浏览器布局测量（如 getBBox）；在无布局引擎的环境（如 jsdom）静默回退标准 SVG。
  if (typeof (svgEl as unknown as { getBBox?: unknown }).getBBox !== 'function') return
  try {
    inkSvg(svgEl, {
      style: { ...styles.draft, pen: gpen },
      seed,
    })
  } catch {
    // 某些特殊 SVG 图元无法手绘重描时保留原始矢量输出
  }
}
