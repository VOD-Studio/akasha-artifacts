// @vitest-environment jsdom
import { expect, it } from 'vitest'
import { bindPrototype, hasPlayableControls } from '../src/prototype/binding'
import { preparePrototypeMedia } from '../src/prototype/media'

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
  '<button type="button" popovertarget="menu">更多</button><div id="menu" popover>选项</div>',
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
    <button type="button" popovertarget="missing">不指向弹出层</button>
    <fieldset disabled><input></fieldset>
    <div inert><select><option>茶席</option></select></div>
    <div hidden><a data-ak-next="done">继续</a></div>`
  expect(hasPlayableControls(root, { scoped: true })).toBe(false)
})

it('设计预览只保留视频封面，不挂载音视频资源或播放控件', () => {
  const template = document.createElement('template')
  template.innerHTML = `
    <video autoplay controls poster="data:image/png;base64,AA">
      <source src="data:video/webm;base64,AA">
      <track src="blob:null/subtitles">
    </video>
    <audio autoplay controls src="data:audio/wav;base64,AA"></audio>
    <picture><source srcset="data:image/png;base64,AA"><img alt=""></picture>`

  preparePrototypeMedia(template.content, false)

  const video = template.content.querySelector('video')
  expect(video?.getAttribute('poster')).toBe('data:image/png;base64,AA')
  expect(template.content.querySelectorAll('[autoplay], [controls], [src]')).toHaveLength(0)
  expect(template.content.querySelector('picture source')?.getAttribute('srcset')).toBe(
    'data:image/png;base64,AA',
  )
})

it('试玩仅为内嵌媒体提供原生控件，媒体不构成独立的试玩能力', () => {
  const template = document.createElement('template')
  template.innerHTML = `
    <audio autoplay src="https://example.test/sound">
      <source src="/sound">
      <source src=" data:audio/wav;base64,AA ">
    </audio>
    <video autoplay muted src="blob:null/video">
      <track src="//example.test/subtitles">
    </video>
    <audio controls src="https://example.test/another-sound"></audio>`

  preparePrototypeMedia(template.content, true)
  const root = document.createElement('main')
  root.append(template.content)

  expect(root.querySelectorAll('[autoplay]')).toHaveLength(0)
  expect(root.querySelector('video')?.hasAttribute('muted')).toBe(true)
  expect([...root.querySelectorAll('[src]')].map((source) => source.getAttribute('src'))).toEqual([
    'data:audio/wav;base64,AA',
    'blob:null/video',
  ])
  expect(root.querySelectorAll('audio[controls]')).toHaveLength(1)
  expect(root.querySelector('audio')?.controls).toBe(true)
  expect(root.querySelector('video')?.controls).toBe(true)
  expect(hasPlayableControls(root)).toBe(false)
})
