// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { hasOverviewMotion, loopOverviewMotion, pauseOverviewMotion } from '../src/overview/motion'

function cssMotion({ paused = false, transition = false } = {}) {
  let iterations = 2
  const effect = {
    getTiming: () => ({ iterations }),
    getComputedTiming: () => ({ duration: 250 }),
    updateTiming: ({ iterations: next }: EffectTiming) => {
      if (next !== undefined) iterations = next
    },
  }
  return {
    ...(transition ? { transitionProperty: 'opacity' } : { animationName: 'fade' }),
    playState: paused ? 'paused' : 'running',
    playbackRate: 1,
    effect,
  }
}

function rootWithAnimations(...animations: ReturnType<typeof cssMotion>[]) {
  const root = document.createElement('div')
  Object.defineProperty(root, 'getAnimations', { value: () => animations })
  return root
}

afterEach(() => vi.useRealTimers())

describe('画板总览动效', () => {
  it('识别 CSS 关键帧和内联 SMIL，但不把过渡或静态 SVG 当作画板动画', () => {
    const root = rootWithAnimations(cssMotion({ transition: true }))
    root.innerHTML = '<svg><circle r="12" /></svg>'
    expect(hasOverviewMotion(root)).toBe(false)
    root.innerHTML = '<svg><circle r="12"><animate attributeName="r" dur="1s" /></circle></svg>'
    expect(hasOverviewMotion(root)).toBe(true)
    expect(hasOverviewMotion(rootWithAnimations(cssMotion()))).toBe(true)
  })

  it('循环有限 CSS 关键帧；作者暂停和原样式的过渡不参与循环', () => {
    const animation = cssMotion()
    const transition = cssMotion({ transition: true })
    const authorPaused = cssMotion({ paused: true })
    const loop = loopOverviewMotion(rootWithAnimations(animation, transition, authorPaused))
    expect(animation.effect.getTiming().iterations).toBe(Infinity)
    expect(transition.effect.getTiming().iterations).toBe(2)
    expect(authorPaused.effect.getTiming().iterations).toBe(2)
    loop.resume()
    expect(animation.effect.getTiming().iterations).toBe(2)
  })

  it('仅恢复由总览停住的时间轴，不主动播放作者暂停的动画', () => {
    const animation = cssMotion()
    animation.playbackRate = 2
    const authorPaused = cssMotion({ paused: true })
    const pause = pauseOverviewMotion(rootWithAnimations(animation, authorPaused))
    expect(animation.playbackRate).toBe(0)
    expect(authorPaused.playbackRate).toBe(1)
    pause.sync()
    pause.resume()
    expect(animation.playbackRate).toBe(2)
    expect(authorPaused.playState).toBe('paused')
  })

  it('按原时序循环有限 SMIL，暂停时不倒带', () => {
    vi.useFakeTimers()
    const root = document.createElement('div')
    root.innerHTML =
      '<svg><circle r="8"><animate attributeName="r" begin="250ms" dur=".5s" repeatCount="2" /></circle></svg>'
    const svg = root.querySelector('svg')
    let time = 0
    let paused = false
    const rewind = vi.fn((next: number) => {
      time = next
    })
    Object.defineProperties(svg, {
      animationsPaused: { value: () => paused },
      getCurrentTime: { value: () => time },
      setCurrentTime: { value: rewind },
      pauseAnimations: {
        value: () => {
          paused = true
        },
      },
      unpauseAnimations: {
        value: () => {
          paused = false
        },
      },
    })
    const loop = loopOverviewMotion(root)
    time = 1.25
    vi.advanceTimersByTime(1250)
    expect(rewind).toHaveBeenCalledTimes(1)
    expect(rewind).toHaveBeenLastCalledWith(0)
    time = 0.75
    const pause = pauseOverviewMotion(root)
    expect(paused).toBe(true)
    vi.advanceTimersByTime(2000)
    expect(rewind).toHaveBeenCalledTimes(1)
    pause.resume()
    expect(paused).toBe(false)
    expect(time).toBe(0.75)
    loop.sync()
    time = 1.25
    vi.advanceTimersByTime(500)
    expect(rewind).toHaveBeenCalledTimes(2)
    expect(rewind).toHaveBeenLastCalledWith(0)
    loop.resume()
  })
})
