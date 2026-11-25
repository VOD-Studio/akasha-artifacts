const SMIL_SELECTOR = 'animate, animateMotion, animateTransform, set, discard'
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg'

/** 内嵌的 SMIL 元素；图片 URL 内的动画不属于这条时间轴。 */
export function smilElements(root: HTMLElement): SVGAnimationElement[] {
  return Array.from(root.querySelectorAll<SVGAnimationElement>(SMIL_SELECTOR)).filter(
    (element) => element.namespaceURI === SVG_NAMESPACE && element.ownerSVGElement,
  )
}

/** 嵌套 SVG 使用最外层 SVG 的 SMIL 时间轴。 */
export function smilTimeline(element: SVGAnimationElement): SVGSVGElement | null {
  let svg = element.ownerSVGElement
  while (svg?.ownerSVGElement) svg = svg.ownerSVGElement
  return svg
}

function clock(value: string): number | undefined {
  if (value === 'indefinite') return Infinity
  const full = /^([+-]?)(?:(\d+):)?([0-5]\d):([0-5]\d(?:\.\d+)?)$/.exec(value)
  if (full) {
    const [, sign, hours, minutes, seconds] = full
    const secondsTotal = Number(hours ?? 0) * 3600 + Number(minutes) * 60 + Number(seconds)
    return sign === '-' ? -secondsTotal : secondsTotal
  }
  const count = /^([+-]?(?:\d+(?:\.\d+)?|\.\d+))(h|min|s|ms)?$/.exec(value)
  if (!count) return undefined
  const [, amount, suffix] = count
  const multiplier = { h: 3600, min: 60, s: 1, ms: 0.001 }
  return Number(amount) * multiplier[(suffix ?? 's') as keyof typeof multiplier]
}

function duration(element: SVGAnimationElement, attr: string, fallback: number): number {
  const value = element.getAttribute(attr)
  return value === null ? fallback : (clock(value.trim()) ?? fallback)
}

function absoluteTimes(value: string): number[] | undefined {
  const times: number[] = []
  for (const part of value.split(';')) {
    const time = clock(part.trim())
    if (time === undefined) return undefined
    times.push(time)
  }
  return times
}

function timelineEnd(element: SVGAnimationElement): number | undefined {
  const begins = absoluteTimes(element.getAttribute('begin') ?? '0')
  const ends = absoluteTimes(element.getAttribute('end') ?? 'indefinite')
  if (!begins || !ends) return undefined

  const simple = duration(element, 'dur', Infinity)
  const repeatCount = element.getAttribute('repeatCount')
  const repeatDuration = element.getAttribute('repeatDur')
  const indefinite = repeatCount?.trim() === 'indefinite' || (!repeatCount && repeatDuration)
  const repetitions = indefinite ? Infinity : Number(repeatCount ?? 1)
  if (!(repetitions > 0) || !(simple > 0)) return 0
  const active = Math.max(
    duration(element, 'min', 0),
    Math.min(
      simple * repetitions,
      duration(element, 'repeatDur', Infinity),
      duration(element, 'max', Infinity),
    ),
  )
  let last = 0
  for (const begin of begins) {
    if (!Number.isFinite(begin)) continue
    let end = begin + active
    for (const limit of ends) {
      if (limit >= begin && limit < end) end = limit
    }
    last = Math.max(last, end)
  }
  return last
}

/** 只为有确定终点的 SMIL 时间轴创建循环，不改写作者的开始、结束或重复规则。 */
export function createSmilLoops(root: HTMLElement) {
  const loops = new Map<SVGSVGElement, { duration: number; cancel: () => void }>()
  const win = root.ownerDocument.defaultView

  return {
    sync() {
      if (!win) return
      const durations = new Map<SVGSVGElement, number>()
      for (const element of smilElements(root)) {
        const svg = smilTimeline(element)
        if (!svg?.getCurrentTime || !svg.setCurrentTime) continue
        durations.set(svg, Math.max(durations.get(svg) ?? 0, timelineEnd(element) ?? Infinity))
      }
      for (const [svg, loop] of loops) {
        if (durations.get(svg) === loop.duration && !svg.animationsPaused()) continue
        loop.cancel()
        loops.delete(svg)
      }
      for (const [svg, duration] of durations) {
        if (
          !Number.isFinite(duration) ||
          duration <= 0 ||
          loops.has(svg) ||
          svg.animationsPaused()
        ) {
          continue
        }
        let timer: number
        const tick = () => {
          if (svg.animationsPaused()) {
            loops.delete(svg)
            return
          }
          let time = svg.getCurrentTime()
          if (time >= duration) {
            time %= duration
            svg.setCurrentTime(time)
          }
          timer = win.setTimeout(
            tick,
            Math.min(2_147_483_647, Math.max(16, (duration - time) * 1000)),
          )
        }
        loops.set(svg, { duration, cancel: () => win.clearTimeout(timer) })
        tick()
      }
    },
    dispose() {
      for (const loop of loops.values()) loop.cancel()
      loops.clear()
    },
  }
}
