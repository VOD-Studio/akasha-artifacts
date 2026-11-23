import type { ElementRef } from '@akasha/protocol'
import { useEffect, useRef } from 'react'

export function DecisionSourceError({ error }: { error: string }) {
  return (
    <div
      role="alert"
      className="m-5 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900"
    >
      <p className="font-semibold">模板内容无法解析</p>
      <p className="mt-1 break-words">{error}</p>
    </div>
  )
}

export function useDecisionRendered(
  source: string,
  version: number,
  onRendered: () => void,
  view?: string,
) {
  const reporter = useRef(onRendered)
  reporter.current = onRendered
  useEffect(() => {
    // 源码、版本或可见批注锚点变化后刷新外壳的定位。
    void source
    void version
    void view
    reporter.current()
  }, [source, version, view])
}

export function annotationAnchor(el: Element): Pick<ElementRef, 'rect'> {
  const { x, y, width, height } = el.getBoundingClientRect()
  return { rect: { x, y, width, height } }
}
