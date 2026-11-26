const PREFIX = 'ak-catalog:'
const MAX_SELECTOR = 1024
const MAX_SIBLINGS = 960
const pathSegment = /^(?:[\w-]|\\[^\w\s])+?:nth-of-type\([1-9]\d*\)$/

/** 已限定在同一个沙盒文档内的固定系统样式树。 */
export interface CatalogScope {
  host: Element
  shadow: ShadowRoot
  content: Element
  id: string
  version: string
}

/** 只识别组合设计在 section 的 open root 内渲染的固定系统，不进入任意 Web Component 或 iframe。 */
export function catalogScope(host: Element): CatalogScope | null {
  if (host.localName !== 'section') return null
  const shadow = host.shadowRoot
  const content = shadow?.firstElementChild
  if (!shadow || !content || content.localName !== 'main' || content.nextElementSibling) return null
  const id = content.getAttribute('data-ak-system')
  const version = content.getAttribute('data-ak-system-version')
  if (!id || !/^[a-z\d]{16,32}$/i.test(id) || !version || !/^[1-9]\d{0,15}$/.test(version))
    return null
  return { host, shadow, content, id, version }
}

/** 同时验证内层归属和沙盒根；不沿 composed tree 穿越其他树或文档。 */
export function scopeForElement(element: Element, root: Element) {
  const tree = element.getRootNode()
  const ShadowRootCtor = root.ownerDocument.defaultView?.ShadowRoot
  if (!ShadowRootCtor || !(tree instanceof ShadowRootCtor)) return null
  const host = tree.host
  if (!root.contains(host)) return null
  const scope = catalogScope(host)
  return scope?.shadow === tree && scope.content.contains(element) ? scope : null
}

/** 外层记录来源和同级系统组，内层为相对固定版本 main 的结构路径。 */
export function scopedLayerSelector(scope: CatalogScope, hostPath: string, innerPath: string) {
  return `${PREFIX}${scope.id}@${scope.version}|${hostPath}|${innerPath}`
}

function structuralPath(path: string) {
  const parts = path.split(' > ')
  return (
    parts[0] === ':scope' &&
    parts.length > 1 &&
    parts.length <= 32 &&
    parts.slice(1).every((part) => pathSegment.test(part))
  )
}

/** undefined 是普通 CSS；失效或含糊的固定来源返回 null，不能再降级到其他组件的同名文字。 */
export function resolveScopedSelector(root: Element, selector: string): Element | null | undefined {
  if (!selector.startsWith(PREFIX)) return undefined
  if (selector.length > MAX_SELECTOR) return null
  const [identity, hostPath, innerPath, extra] = selector.slice(PREFIX.length).split('|')
  if (
    extra !== undefined ||
    !hostPath ||
    innerPath === undefined ||
    !structuralPath(hostPath) ||
    (innerPath && !structuralPath(innerPath))
  )
    return null
  const end = hostPath.lastIndexOf(' > ')
  if (!/^section:nth-of-type\([1-9]\d*\)$/.test(hostPath.slice(end + 3))) return null
  const parentPath = hostPath.slice(0, end)
  try {
    const group = parentPath === ':scope' ? root : root.querySelector(parentPath)
    if (!group || group.childElementCount > MAX_SIBLINGS) return null
    let matched: CatalogScope | null = null
    for (const host of group.children) {
      const scope = catalogScope(host)
      if (!scope || `${scope.id}@${scope.version}` !== identity) continue
      if (matched) return null
      matched = scope
    }
    if (!matched) return null
    return innerPath ? matched.content.querySelector(innerPath) : matched.content
  } catch {
    return null
  }
}

/** 先在本沙盒文档命中宿主，再在该来源的同一视口内命中实际元素；不模拟点击。 */
export function inspectPoint(root: HTMLElement, x: number, y: number) {
  const host = root.ownerDocument.elementFromPoint(x, y)
  if (!host || !root.contains(host)) return null
  const scope = catalogScope(host)
  if (!scope) return host
  const hit = scope.shadow.elementFromPoint?.(x, y)
  if (hit && scope.content.contains(hit)) return hit
  return host
}
