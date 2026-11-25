import type { ComponentPropsWithoutRef } from 'react'

const MONOLITH_LEFT = 'M 9 52 L 26 12 L 34.5 12 L 17.5 52 Z'
const MONOLITH_SPINE = 'M 26.5 40.7 L 34.5 21.9 L 34.5 52 L 26.5 52 Z'
const MONOLITH_WING = 'M 38.3 32 L 46.5 12 L 55 12 L 46.8 32 L 55 52 L 46.5 52 Z'

export interface AkashaMarkProps extends Omit<ComponentPropsWithoutRef<'svg'>, 'children'> {
  /** 边长像素值；默认 `24`。 */
  size?: number
  /** 为 `true` 时播放三段定向光幕加载动效；减弱动态下自动退化为温和呼吸。 */
  loading?: boolean
  /** 提供时以 `role="img"` 暴露给读屏；省略时视为紧邻文案的装饰图形并置 `aria-hidden`。 */
  label?: string
}

/** Akasha 刀锋 AK 品牌徽标，同时承载静态标识与加载状态动效。 */
export function AkashaMark({
  size = 24,
  loading = false,
  label,
  className,
  ...props
}: AkashaMarkProps) {
  const classes = className ? `akasha-mark ${className}` : 'akasha-mark'
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 64 64"
      width={size}
      height={size}
      fill="none"
      data-loading={loading ? 'true' : 'false'}
      className={classes}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
      {...props}
    >
      {loading && (
        <g className="akasha-mark-ghost">
          <path fill="currentColor" d={MONOLITH_LEFT} />
          <path fill="currentColor" d={MONOLITH_SPINE} />
          <path fill="currentColor" d={MONOLITH_WING} />
        </g>
      )}
      <path className="akasha-mark-left" fill="currentColor" d={MONOLITH_LEFT} />
      <path className="akasha-mark-spine" fill="currentColor" d={MONOLITH_SPINE} />
      <path className="akasha-mark-wing" fill="currentColor" d={MONOLITH_WING} />
    </svg>
  )
}
