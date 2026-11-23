const CONTROL = [
  'button',
  'input:not([type="hidden"]):not([readonly])',
  'select',
  'textarea:not([readonly])',
  'details > summary',
  'a[href], a[data-ak-next]',
  '[contenteditable="true"]',
  '[role="button"][tabindex]',
].join(',')
const ACTION =
  'button, input[type="button"], input[type="submit"], input[type="image"], a, [role="button"][tabindex]'

/** 只把实际可用的控件视为试玩入口；普通外链不会在试玩中打开。 */
export function hasPlayableControls(root: HTMLElement): boolean {
  for (const element of root.querySelectorAll(CONTROL)) {
    if (element.matches(':disabled, [aria-disabled="true"]')) continue
    if (element.closest('[hidden], [inert], [aria-hidden="true"]')) continue
    if (element.checkVisibility?.({ visibilityProperty: true }) === false) continue
    if (element.matches('a') && !nextBoard(element) && !isLocalLink(element)) continue
    return true
  }
  return false
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
