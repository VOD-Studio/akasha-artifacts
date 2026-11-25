/** 画布快捷键只处理本画布或页面空白上的按键；输入、弹层和其他工作区保留原生行为。 */
export function acceptsCanvasShortcut(event: KeyboardEvent, shell: Element | null | undefined) {
  if (!shell || shell.hasAttribute('hidden') || event.defaultPrevented || event.isComposing)
    return false
  const target = event.target instanceof Element ? event.target : document.activeElement
  if (!target || target === document.body) return true
  return (
    shell.contains(target) &&
    !target.closest(
      'input, textarea, select, [contenteditable]:not([contenteditable="false"]), dialog, [role="dialog"], [role="menu"], [role="listbox"]',
    )
  )
}
