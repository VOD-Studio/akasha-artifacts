import type { ComponentProps, ReactNode } from 'react'
import { type BadgeVariantProps, badgeVariants } from './styles'

/** 状态文字本身就是信息；圆点或图标只是装饰，对读屏隐藏。 */
export interface BadgeProps extends ComponentProps<'span'>, BadgeVariantProps {
  /** 取代圆点（如定时用的时钟）。 */
  icon?: ReactNode
  /** 仅在明确需要实时状态圆点时开启，默认关闭以避免静态标签冗余圆点。 */
  dot?: boolean
}

/**
 * 表示记录状态的克制标签；颜色只表示状态，不做装饰。
 */
export function Badge({
  tone = 'neutral',
  icon,
  dot = false,
  className,
  children,
  ...props
}: BadgeProps) {
  return (
    <span data-slot="badge" {...props} className={badgeVariants({ tone, className })}>
      {icon != null ? (
        <span className="v-badge__icon" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      {icon == null && dot ? <span className="v-badge__dot" aria-hidden="true" /> : null}
      {children}
    </span>
  )
}
