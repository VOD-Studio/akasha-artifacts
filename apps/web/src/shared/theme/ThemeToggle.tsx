import { useTheme } from '@akasha/ui'
import { Button } from '@akasha/ui/button'
import { useId } from 'react'
import { flushSync } from 'react-dom'
import { type Messages, useMessages } from '@/shared/i18n'

const themeMessages = {
  切换到浅色外观: [
    'Zu hellem Design wechseln',
    'التبديل إلى المظهر الفاتح',
    'Switch to light theme',
  ],
  切换到深色外观: [
    'Zu dunklem Design wechseln',
    'التبديل إلى المظهر الداكن',
    'Switch to dark theme',
  ],
} as const satisfies Messages

const BLADE_COUNT = 6
const SLANT_PCT = 10
const OVERLAP_PCT = 0.6
const STAGGER_SHARE = 0.34
const SAMPLE_STEPS = 28
const TRANSITION_MS = 640

let transitionSeq = 0

function easeOutBlade(t: number): number {
  const clamped = Math.max(0, Math.min(1, t))
  return 1 - (1 - clamped) ** 3.6
}

/** 生成 6 道斜向建筑光幕（单闭合多边形，顶边零面积桥接）的逐帧 clip-path 关键帧。 */
export function buildBladeClipKeyframes(toDark: boolean): string[] {
  const startX = -1
  const totalSpan = 102 + SLANT_PCT
  const step = totalSpan / BLADE_COUNT
  const fullWidth = step + OVERLAP_PCT
  const bladeSpan = 1 - STAGGER_SHARE
  const frames: string[] = []

  for (let frame = 0; frame <= SAMPLE_STEPS; frame += 1) {
    const t = frame / SAMPLE_STEPS
    const vertices: string[] = []

    for (let i = 0; i < BLADE_COUNT; i += 1) {
      const order = toDark ? BLADE_COUNT - 1 - i : i
      const bladeStart = (order / (BLADE_COUNT - 1)) * STAGGER_SHARE
      const progress = easeOutBlade((t - bladeStart) / bladeSpan)
      const colLeft = startX + i * step
      const colRight = colLeft + fullWidth
      const left = toDark ? colRight - progress * fullWidth : colLeft
      const right = toDark ? colRight : colLeft + progress * fullWidth
      const bl = left - SLANT_PCT
      const br = right - SLANT_PCT

      vertices.push(
        `${left.toFixed(2)}% 0%`,
        `${bl.toFixed(2)}% 100%`,
        `${br.toFixed(2)}% 100%`,
        `${right.toFixed(2)}% 0%`,
      )
    }

    frames.push(`polygon(${vertices.join(', ')})`)
  }

  return frames
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

function runThemeTransition(toDark: boolean, apply: () => void): void {
  if (typeof document.startViewTransition !== 'function' || prefersReducedMotion()) {
    apply()
    return
  }

  const root = document.documentElement
  const seq = ++transitionSeq
  root.setAttribute('data-theme-transition', toDark ? 'to-dark' : 'to-light')

  let transition: ViewTransition
  try {
    transition = document.startViewTransition(() => {
      flushSync(apply)
    })
  } catch {
    if (transitionSeq === seq) root.removeAttribute('data-theme-transition')
    apply()
    return
  }

  void transition.ready
    .then(() => {
      if (transitionSeq !== seq) return
      root.animate(
        { clipPath: buildBladeClipKeyframes(toDark) },
        {
          duration: TRANSITION_MS,
          easing: 'linear',
          fill: 'both',
          pseudoElement: '::view-transition-new(root)',
        },
      )
      root.animate(
        { transform: ['scale(1.015)', 'scale(1)'] },
        {
          duration: TRANSITION_MS,
          easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
          fill: 'both',
          pseudoElement: '::view-transition-new(root)',
        },
      )
      root.animate(
        {
          filter: ['brightness(1)', toDark ? 'brightness(0.92)' : 'brightness(1.06)'],
        },
        {
          duration: TRANSITION_MS,
          easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
          fill: 'both',
          pseudoElement: '::view-transition-old(root)',
        },
      )
    })
    .catch(() => {
      // 连续快速点击会中断上一次过渡，忽略中断异常即可。
    })

  void transition.finished.finally(() => {
    if (transitionSeq === seq) root.removeAttribute('data-theme-transition')
  })
}

function EclipseThemeIcon({ showSun }: { showSun: boolean }) {
  const maskId = useId()
  return (
    <svg
      viewBox="0 0 24 24"
      width={16}
      height={16}
      fill="none"
      aria-hidden="true"
      className="theme-toggle-icon"
      data-sun={showSun ? 'true' : 'false'}
    >
      <mask id={maskId} maskUnits="userSpaceOnUse">
        <rect x="0" y="0" width="24" height="24" fill="white" />
        <circle className="theme-toggle-cutout" cx="16.4" cy="8.2" r="6.2" fill="black" />
      </mask>
      <g mask={`url(#${maskId})`}>
        <circle className="theme-toggle-core" cx="12" cy="12" r="6.8" fill="currentColor" />
      </g>
      <g
        className="theme-toggle-rays"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
      >
        <line x1="12" y1="2.2" x2="12" y2="4.2" />
        <line x1="12" y1="19.8" x2="12" y2="21.8" />
        <line x1="2.2" y1="12" x2="4.2" y2="12" />
        <line x1="19.8" y1="12" x2="21.8" y2="12" />
        <line x1="5.07" y1="5.07" x2="6.49" y2="6.49" />
        <line x1="17.51" y1="17.51" x2="18.93" y2="18.93" />
        <line x1="5.07" y1="18.93" x2="6.49" y2="17.51" />
        <line x1="17.51" y1="6.49" x2="18.93" y2="5.07" />
      </g>
    </svg>
  )
}

/** 亮/暗外观切换按钮：日蚀变形图标 + 6 道斜向建筑光幕百叶过渡。 */
export function ThemeToggle() {
  const { t } = useMessages(themeMessages)
  const { resolvedTheme, setTheme } = useTheme('system')
  const isDark = resolvedTheme === 'dark'
  const label = t(isDark ? '切换到浅色外观' : '切换到深色外观')

  const toggle = () => {
    const next = isDark ? 'light' : 'dark'
    runThemeTransition(next === 'dark', () => setTheme(next))
  }

  return (
    <Button variant="ghost" size="sm" iconOnly aria-label={label} title={label} onClick={toggle}>
      <EclipseThemeIcon showSun={isDark} />
    </Button>
  )
}
