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
    expect(hasPlayableControls(root, { scoped: true })).toBe(true)
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

it('只把独立 React 的动态按钮视为隐式动作', () => {
  const root = document.createElement('main')
  root.innerHTML = `
    <button>视觉样例</button>
    <input type="button" value="没有事件">
    <input type="submit" value="没有表单">
    <div role="button" tabindex="0">按钮样式</div>
    <a href="https://example.com">外链</a>
    <a href="#">占位链接</a>
    <audio controls></audio>`
  expect(hasPlayableControls(root, { scoped: true })).toBe(false)
  expect(hasPlayableControls(root)).toBe(true)
})

it.each([
  '<button data-ak-next="done">继续</button>',
  '<a data-ak-next="done">继续</a>',
  '<a href="#details">查看</a><p id="details">详情</p>',
  '<form data-ak-next="done"><button>提交</button></form>',
  '<form id="booking"></form><button form="booking">提交</button>',
  '<details><summary>更多</summary><p>详情</p></details>',
  '<input type="text">',
  '<select><option>茶席</option></select>',
  '<textarea></textarea>',
  '<p contenteditable>可以输入</p>',
])('识别 scoped HTML 的真实交互：%s', (markup) => {
  const root = document.createElement('main')
  document.body.append(root)
  try {
    root.innerHTML = markup
    expect(hasPlayableControls(root, { scoped: true })).toBe(true)
  } finally {
    root.remove()
  }
})

it('不把不可用的输入与导航当作试玩入口', () => {
  const root = document.createElement('main')
  root.innerHTML = `
    <input type="hidden">
    <input readonly>
    <textarea readonly></textarea>
    <button data-ak-next="done" disabled>继续</button>
    <fieldset disabled><input></fieldset>
    <div inert><select><option>茶席</option></select></div>
    <div hidden><a data-ak-next="done">继续</a></div>`
  expect(hasPlayableControls(root, { scoped: true })).toBe(false)
})
