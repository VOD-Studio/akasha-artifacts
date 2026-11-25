import { useState, useSyncExternalStore } from 'react'

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)'

function subscribe(listener: () => void) {
  const media = window.matchMedia?.(REDUCED_MOTION)
  media?.addEventListener('change', listener)
  document.addEventListener('visibilitychange', listener)
  return () => {
    media?.removeEventListener('change', listener)
    document.removeEventListener('visibilitychange', listener)
  }
}

function allowsAnimation() {
  return !document.hidden && !window.matchMedia?.(REDUCED_MOTION)?.matches
}

/** 暂停属于当前画布会话；手动恢复也不能覆盖系统的减弱动态偏好。 */
export function useOverviewPlayback() {
  const allowed = useSyncExternalStore(subscribe, allowsAnimation, () => false)
  const [paused, setPaused] = useState(false)
  return {
    paused,
    allowsAnimation: allowed && !paused,
    togglePause: () => setPaused((value) => !value),
  }
}
