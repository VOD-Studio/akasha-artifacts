export interface OverviewMotion {
  sync: () => void
  resume: () => void
}

/** 暂停当前画板的原生时间轴，不修改作者样式或重挂 DOM。 */
export function pauseOverviewMotion(root: HTMLElement): OverviewMotion {
  const animations = new WeakSet<Animation>()
  const svgRoots = new WeakSet<SVGSVGElement>()

  const sync = () => {
    for (const animation of root.getAnimations?.({ subtree: true }) ?? []) {
      if (animation.playState !== 'running') continue
      animation.pause()
      animations.add(animation)
    }
    for (const svg of root.querySelectorAll<SVGSVGElement>('svg')) {
      // 嵌套 SVG 共用最外层 SVG 的 SMIL 时间轴。
      if (svg.ownerSVGElement || !svg.pauseAnimations || svg.animationsPaused()) continue
      svg.pauseAnimations()
      svgRoots.add(svg)
    }
  }

  const observer = new MutationObserver(sync)
  observer.observe(root, { subtree: true, childList: true, attributes: true, characterData: true })
  // 伪类和媒体查询可以不经过 DOM mutation 就启动 CSS 动画或过渡。
  root.addEventListener('animationstart', sync)
  root.addEventListener('transitionrun', sync)
  window.addEventListener('resize', sync)
  sync()

  return {
    sync,
    resume() {
      observer.disconnect()
      root.removeEventListener('animationstart', sync)
      root.removeEventListener('transitionrun', sync)
      window.removeEventListener('resize', sync)
      // 只恢复由总览暂停的对象，不启动作者自身已暂停的动画。
      for (const animation of root.getAnimations?.({ subtree: true }) ?? []) {
        if (animations.has(animation) && animation.playState === 'paused') animation.play()
      }
      for (const svg of root.querySelectorAll<SVGSVGElement>('svg')) {
        if (svgRoots.has(svg) && svg.animationsPaused()) svg.unpauseAnimations()
      }
    },
  }
}
