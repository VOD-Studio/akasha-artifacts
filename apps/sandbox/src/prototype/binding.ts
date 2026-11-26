import { catalogScope } from '../inspector/catalog-scope'

const NATIVE_CONTROL = [
  'select',
  'textarea:not([readonly])',
  'details > summary',
  '[contenteditable=""], [contenteditable="true" i], [contenteditable="plaintext-only" i]',
].join(',')
const ACTION =
  'button, input[type="button"], input[type="submit"], input[type="image"], a, [role="button"][tabindex]'
const CONTROL = `${NATIVE_CONTROL},${ACTION},input:not([type="hidden"]):not([readonly])`

function containsPlayableControl(root: Element, scoped: boolean): boolean {
  for (const element of root.querySelectorAll(CONTROL)) {
    if (element.matches(':disabled, [aria-disabled="true"], audio, video, input[type="hidden"]')) {
      continue
    }
    if (element.closest('[hidden], [inert], [aria-hidden="true"]')) continue
    if (element.checkVisibility?.({ visibilityProperty: true }) === false) continue
    if (element.matches('a')) {
      if (nextBoard(element) || isLocalLink(element)) return true
      continue
    }
    if (!scoped || (element.matches(ACTION) && nextBoard(element))) return true
    if (hasNativeAction(element, root)) return true
  }
  return false
}

/** 静态 HTML 维持原来的导航和表单规则，独立 React 额外识别固定系统内的真实交互控件。 */
export function hasPlayableControls(
  root: HTMLElement,
  {
    scoped = false,
    observeCatalog,
  }: { scoped?: boolean; observeCatalog?: (shadow: ShadowRoot) => void } = {},
): boolean {
  let playable = containsPlayableControl(root, scoped)
  if (scoped || (playable && !observeCatalog)) return playable
  for (const host of root.querySelectorAll('section')) {
    const scope = catalogScope(host)
    if (!scope) continue
    observeCatalog?.(scope.shadow)
    if (
      !playable &&
      !host.closest('[hidden], [inert], [aria-hidden="true"]') &&
      containsPlayableControl(scope.content, false)
    ) {
      if (!observeCatalog) return true
      playable = true
    }
  }
  return playable
}

function hasNativeAction(element: Element, root: Element): boolean {
  if (element.matches(NATIVE_CONTROL)) return true
  if (!(element instanceof HTMLButtonElement || element instanceof HTMLInputElement)) return false
  const { type, form } = element
  if (type === 'button' || (!form && element instanceof HTMLButtonElement)) {
    const id = element.getAttribute('popovertarget')
    const popover = id ? root.ownerDocument.getElementById(id) : null
    if (popover && root.contains(popover) && popover.hasAttribute('popover')) return true
  }
  if (type === 'submit' || type === 'image' || type === 'reset') {
    return form !== null && root.contains(form)
  }
  return element instanceof HTMLInputElement && type !== 'button' && !element.readOnly
}

function nextBoard(element: Element | null): string | undefined {
  const target = element?.getAttribute('data-ak-next')
  return target && target.length <= 1024 ? target : undefined
}

function isLocalLink(element: Element): boolean {
  const href = element.getAttribute('href')
  return Boolean(href?.startsWith('#') && href.length > 1)
}

function isSubmitter(element: Element): element is HTMLButtonElement | HTMLInputElement {
  return (
    (element instanceof HTMLButtonElement && element.type === 'submit') ||
    (element instanceof HTMLInputElement && (element.type === 'submit' || element.type === 'image'))
  )
}

interface PrototypeActions {
  navigate: (boardId: string) => void
  exit: () => void
}

/** 试玩仅转发作者声明的动作；表单先通过浏览器约束验证，再通知外壳。 */
export function bindPrototype(root: HTMLElement, { navigate, exit }: PrototypeActions) {
  const view = root.ownerDocument.defaultView
  if (!view) return
  const click = (event: MouseEvent) => {
    if (event.defaultPrevented || !(event.target instanceof Element)) return
    const control = event.target.closest(ACTION)
    if (!control || !root.contains(control)) return
    if (control.matches(':disabled, [aria-disabled="true"]')) {
      event.preventDefault()
      return
    }
    if (isSubmitter(control) && control.form) {
      const form = control.form
      event.preventDefault()
      // allow-scripts 禁止默认表单提交；本地仍要校验控件并触发 React 的 onSubmit。
      if (form.noValidate || control.formNoValidate || form.reportValidity()) {
        form.dispatchEvent(
          new SubmitEvent('submit', { bubbles: true, cancelable: true, submitter: control }),
        )
      }
      return
    }
    const target = nextBoard(control)
    if (!target && (!control.matches('a') || isLocalLink(control))) return
    event.preventDefault()
    if (target) navigate(target)
  }
  const submit = (event: SubmitEvent) => {
    if (event.defaultPrevented || !(event.target instanceof HTMLFormElement)) return
    if (!root.contains(event.target)) return
    event.preventDefault()
    const target = nextBoard(event.submitter) ?? nextBoard(event.target)
    if (target) navigate(target)
  }
  const keydown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || event.isComposing || event.repeat) return
    event.preventDefault()
    exit()
  }
  // click / submit 在 React 委托事件之后读 defaultPrevented，避免重复执行作者已接管的动作。
  view.addEventListener('click', click)
  view.addEventListener('submit', submit)
  view.addEventListener('keydown', keydown, true)
  return () => {
    view.removeEventListener('click', click)
    view.removeEventListener('submit', submit)
    view.removeEventListener('keydown', keydown, true)
  }
}
