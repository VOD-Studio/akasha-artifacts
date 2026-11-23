import type { ElementRef } from '@akasha/protocol'
import { useEffect, useRef } from 'react'

/** 模板源码无法解析时显示的错误卡片。 */
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

/**
 * 源码、版本或视图变化后，通知外壳内容已重新渲染。
 *
 * @param view - 当前视图的标识，例如章节与 diff 模式；它变化时可见的批注锚点也会变。
 */
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

/** 取元素相对视口的矩形，作为批注锚点。 */
export function annotationAnchor(el: Element): Pick<ElementRef, 'rect'> {
  const { x, y, width, height } = el.getBoundingClientRect()
  return { rect: { x, y, width, height } }
}
