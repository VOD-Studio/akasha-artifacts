import type { ArtboardLayoutGuide } from '@akasha/protocol'
import { useMemo } from 'react'

interface BoardLayoutGuidesProps {
  /** 画板固有宽高和辅助线均以 CSS 像素计，不预乘相机倍率。 */
  width: number
  height: number
  guides: readonly ArtboardLayoutGuide[]
}

/** 仅在工作台绘制，随画板坐标系变换，不进入作者内容。 */
export function BoardLayoutGuides({ width, height, guides }: BoardLayoutGuidesProps) {
  const path = useMemo(
    () =>
      guides
        .map(({ axis, position }) =>
          axis === 'x' ? `M${position} 0V${height}` : `M0 ${position}H${width}`,
        )
        .join(''),
    [guides, width, height],
  )
  return (
    <svg
      aria-hidden="true"
      data-layout-guides=""
      className="pointer-events-none absolute inset-0 size-full overflow-hidden"
      viewBox={`0 0 ${width} ${height}`}
      fill="none"
    >
      <path d={path} stroke="white" vectorEffect="non-scaling-stroke" />
      <path d={path} stroke="black" strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}
