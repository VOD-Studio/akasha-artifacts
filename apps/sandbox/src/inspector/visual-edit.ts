import type { SandboxBridgeClient } from '../bridge/client'
import { buildElementRef, uniqueStaticSourceLocation } from './index'

/** 可视化直改的选取器：激活后拦截沙盒内的第一次真实点击，把命中元素上报给外壳。 */
export class SandboxVisualInspector {
  private active = false

  constructor(
    private readonly getRoot: () => HTMLDivElement | null,
    private readonly bridge: Pick<SandboxBridgeClient, 'send'>,
    private readonly getVersion: () => number,
  ) {}

  /** 开关点击拦截；重复设置同一状态无效果。 */
  setActive(active: boolean): void {
    if (active === this.active) return
    this.active = active
    if (active) document.addEventListener('click', this.handleClick, true)
    else document.removeEventListener('click', this.handleClick, true)
  }

  dispose(): void {
    this.setActive(false)
  }

  private readonly handleClick = (event: MouseEvent) => {
    const root = this.getRoot()
    const target = event.target
    const version = this.getVersion()
    if (
      !event.isTrusted ||
      !(target instanceof Element) ||
      !root ||
      version < 1 ||
      !root.contains(target) ||
      target === root ||
      target.hasAttribute('data-ak-renderer')
    )
      return
    event.preventDefault()
    event.stopImmediatePropagation()
    this.setActive(false)
    const loc = uniqueStaticSourceLocation(target, root)
    this.bridge.send({
      type: 'visual.select',
      version,
      element: buildElementRef(target, root),
      ...(loc ? { loc } : {}),
    })
  }
}
