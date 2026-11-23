// @vitest-environment jsdom
import { expect, it } from 'vitest'
import { bindPrototype, hasPlayableControls } from '../src/prototype'

it('保留表单校验，使用提交按钮声明的导航，并支持从输入框退出', () => {
  const root = document.createElement('main')
  root.innerHTML = `
    <form data-ak-next="done">
      <input type="text" required>
      <button type="submit" data-ak-next="review">继续</button>
    </form>`
  document.body.append(root)
  const destinations: string[] = []
  let exited = false
  const dispose = bindPrototype(root, {
    navigate: (target) => destinations.push(target),
    exit: () => {
      exited = true
    },
  })
  try {
    const input = root.querySelector('input') as HTMLInputElement
    const button = root.querySelector('button') as HTMLButtonElement
    expect(hasPlayableControls(root)).toBe(true)
    button.click()
    expect(destinations).toEqual([])
    input.value = '茶席'
    button.click()
    expect(destinations).toEqual(['review'])
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(exited).toBe(true)
  } finally {
    dispose?.()
    root.remove()
  }
})
