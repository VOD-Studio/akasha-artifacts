// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildBladeClipKeyframes, ThemeToggle } from '../src/shared/theme'

afterEach(() => {
  cleanup()
  document.documentElement.removeAttribute('data-theme-transition')
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('ThemeToggle 光幕百叶切换动效', () => {
  it('生成的 6 道斜向光幕关键帧首帧零面积、尾帧完整覆盖视口且方向对称', () => {
    const toDark = buildBladeClipKeyframes(true)
    const toLight = buildBladeClipKeyframes(false)

    expect(toDark.length).toBeGreaterThan(20)
    expect(toLight.length).toBe(toDark.length)
    // 每一帧均为 6 道光幕 × 4 顶点 = 24 个坐标
    for (const frame of [...toDark, ...toLight]) {
      const points = frame.slice('polygon('.length, -1).split(', ')
      expect(points).toHaveLength(24)
    }
    // 尾帧首列左边界 <= 0%，末列底边右边界 >= 100%
    expect(toDark.at(-1)).toContain('-1.00% 0%')
    expect(toLight.at(-1)).toContain('-1.00% 0%')
    // 中间帧深色与浅色方向不同（右向左 vs 左向右）
    const mid = Math.floor(toDark.length / 2)
    expect(toDark[mid]).not.toBe(toLight[mid])
  })

  it('支持 View Transitions 时触发光幕动画并在结束后清理标记', async () => {
    const ready = Promise.withResolvers<void>()
    const finished = Promise.withResolvers<void>()
    const animate = vi.fn()
    const startViewTransition = vi.fn((update: () => void) => {
      update()
      return { ready: ready.promise, finished: finished.promise }
    })

    Object.defineProperty(document, 'startViewTransition', {
      configurable: true,
      value: startViewTransition,
    })
    Object.defineProperty(document.documentElement, 'animate', {
      configurable: true,
      value: animate,
    })

    render(<ThemeToggle />)
    const button = screen.getByRole('button', { name: '切换到深色外观' })
    fireEvent.click(button)

    expect(startViewTransition).toHaveBeenCalledTimes(1)
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(document.documentElement.getAttribute('data-theme-transition')).toBe('to-dark')

    ready.resolve()
    await ready.promise
    expect(animate).toHaveBeenCalledTimes(3)
    expect(animate.mock.calls[0]?.[1]).toMatchObject({
      pseudoElement: '::view-transition-new(root)',
    })
    expect(animate.mock.calls[1]?.[1]).toMatchObject({
      pseudoElement: '::view-transition-new(root)',
    })
    expect(animate.mock.calls[2]?.[1]).toMatchObject({
      pseudoElement: '::view-transition-old(root)',
    })

    finished.resolve()
    await finished.promise
    await Promise.resolve()
    expect(document.documentElement.getAttribute('data-theme-transition')).toBeNull()

    delete (document as { startViewTransition?: unknown }).startViewTransition
  })

  it('减弱动态模式下跳过视图过渡，直接切换主题', () => {
    const startViewTransition = vi.fn()
    Object.defineProperty(document, 'startViewTransition', {
      configurable: true,
      value: startViewTransition,
    })
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => ({
        matches: query === '(prefers-reduced-motion: reduce)',
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    )

    render(<ThemeToggle />)
    const button = screen.getByRole('button')
    const expectDark = button.getAttribute('aria-label') === '切换到深色外观'
    fireEvent.click(button)

    expect(startViewTransition).not.toHaveBeenCalled()
    expect(document.documentElement.classList.contains('dark')).toBe(expectDark)

    delete (document as { startViewTransition?: unknown }).startViewTransition
    vi.unstubAllGlobals()
  })
})
