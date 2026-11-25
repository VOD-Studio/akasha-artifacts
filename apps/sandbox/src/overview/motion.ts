import { createSmilLoops, smilElements, smilTimeline } from './smil'

/** 同步新增时间轴。`resume` 释放本次总览控制，不替作者启动动画。 */
export interface OverviewMotion {
  sync: () => void
  resume: () => void
}

function cssKeyframes(animation: Animation, root: HTMLElement): AnimationEffect | null {
  const effect = animation.effect
  if (!('animationName' in animation) || !effect) return null
  if (animation.timeline && animation.timeline !== root.ownerDocument.timeline) return null
  const duration = effect.getComputedTiming().duration
  return typeof duration === 'number' && duration > 0 && effect.getTiming().iterations !== 0
    ? effect
    : null
}

/** 识别可由沙盒控制的 CSS 关键帧和内联 SMIL，不把过渡或图片当作动画声明。 */
export function hasOverviewMotion(root: HTMLElement): boolean {
  return (
    (root.getAnimations?.({ subtree: true }) ?? []).some((animation) =>
      cssKeyframes(animation, root),
    ) || smilElements(root).length > 0
  )
}

function observe(root: HTMLElement, sync: () => void, transitions = false): () => void {
  const win = root.ownerDocument.defaultView
  const observer = new MutationObserver(sync)
  observer.observe(root, { subtree: true, childList: true, attributes: true, characterData: true })
  // 伪类和媒体查询可以不经过 DOM mutation 就启动时间轴。
  root.addEventListener('animationstart', sync)
  if (transitions) root.addEventListener('transitionrun', sync)
  win?.addEventListener('resize', sync)
  sync()
  return () => {
    observer.disconnect()
    root.removeEventListener('animationstart', sync)
    if (transitions) root.removeEventListener('transitionrun', sync)
    win?.removeEventListener('resize', sync)
  }
}

/** 循环 CSS 关键帧与可确定周期的 SMIL，不循环 CSS 过渡。 */
export function loopOverviewMotion(root: HTMLElement): OverviewMotion {
  const timing = new Map<AnimationEffect, number>()
  const smil = createSmilLoops(root)
  let active = true
  const sync = () => {
    if (!active) return
    const current = new Set<AnimationEffect>()
    for (const animation of root.getAnimations?.({ subtree: true }) ?? []) {
      const effect = cssKeyframes(animation, root)
      if (!effect) continue
      current.add(effect)
      // 不调用 play()，作者的 animation-play-state 仍可生效。
      if (animation.playState === 'paused' || timing.has(effect)) continue
      const iterations = effect.getTiming().iterations
      if (iterations === undefined || !Number.isFinite(iterations)) continue
      timing.set(effect, iterations)
      effect.updateTiming({ iterations: Infinity })
    }
    for (const [effect, iterations] of timing) {
      if (current.has(effect)) continue
      effect.updateTiming({ iterations })
      timing.delete(effect)
    }
    smil.sync()
  }
  const disconnect = observe(root, sync)
  return {
    sync,
    resume() {
      active = false
      disconnect()
      for (const [effect, iterations] of timing) effect.updateTiming({ iterations })
      timing.clear()
      smil.dispose()
    },
  }
}

/** 停住当前画板的原生时间轴，不覆盖作者的播放状态、改动样式或重挂 DOM。 */
export function pauseOverviewMotion(root: HTMLElement): OverviewMotion {
  const rates = new Map<Animation, number>()
  const svgRoots = new Set<SVGSVGElement>()
  let active = true
  const sync = () => {
    if (!active) return
    const currentAnimations = root.getAnimations?.({ subtree: true }) ?? []
    for (const animation of currentAnimations) {
      if (animation.playState !== 'running' || animation.playbackRate === 0) continue
      // pause()/play() 会接管 CSS animation-play-state；零速只冻结时间。
      rates.set(animation, animation.playbackRate)
      animation.playbackRate = 0
    }
    for (const [animation, rate] of rates) {
      if (currentAnimations.includes(animation)) continue
      if (animation.playbackRate === 0) animation.playbackRate = rate
      rates.delete(animation)
    }
    for (const element of smilElements(root)) {
      const svg = smilTimeline(element)
      if (!svg?.pauseAnimations || svg.animationsPaused()) continue
      svg.pauseAnimations()
      svgRoots.add(svg)
    }
    for (const svg of svgRoots) {
      if (root.contains(svg)) continue
      if (svg.animationsPaused()) svg.unpauseAnimations()
      svgRoots.delete(svg)
    }
  }
  const disconnect = observe(root, sync, true)
  return {
    sync,
    resume() {
      active = false
      disconnect()
      for (const [animation, rate] of rates) {
        if (animation.playbackRate === 0) animation.playbackRate = rate
      }
      rates.clear()
      for (const svg of svgRoots) {
        if (svg.animationsPaused()) svg.unpauseAnimations()
      }
      svgRoots.clear()
    },
  }
}
