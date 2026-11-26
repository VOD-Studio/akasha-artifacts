// @vitest-environment jsdom
import { CANVAS_STYLE_LIMITS } from '@akasha/protocol'
import { afterEach, expect, it } from 'vitest'
import { readLayerStyles } from '../src/inspector/layer-styles'

function board(html: string) {
  const root = document.createElement('section')
  root.innerHTML = html
  document.body.append(root)
  const target = root.querySelector('[data-target]')
  if (!target) throw new Error('缺少选中图层')
  return { root, target, read: () => readLayerStyles(target, root, 'selected') }
}

afterEach(() => {
  document.body.replaceChildren()
})

it('只展示作品内真实匹配的选择器、行内声明和最近的继承来源', () => {
  const external = document.createElement('style')
  external.textContent = '.child { outline-width: 7px }'
  document.body.append(external)
  const { read } = board(`
    <style>
      .outer { color: green; font-weight: 500; }
      @media all { .parent { color: teal !important; padding: 4px; width: 20px; } }
      .other, [data-key="a,b"] { letter-spacing: 2px; }
      .sibling { color: red; }
    </style>
    <div class="outer"><div class="parent" style="color: pink">
      <span class="child" data-target data-key="a,b" style="margin-top: 3px"></span>
      <span class="sibling"></span>
    </div></div>`)
  const snapshot = read()
  expect(snapshot.truncated).toBe(false)
  expect(snapshot.declarations).toHaveLength(4)
  expect(snapshot.declarations).toEqual(
    expect.arrayContaining([
      { property: 'margin-top', value: '3px', source: 'style' },
      { property: 'letter-spacing', value: '2px', source: '[data-key="a,b"]' },
      {
        property: 'color',
        value: 'teal',
        source: '.parent',
        important: true,
        inheritedFrom: 'div.parent',
      },
      { property: 'font-weight', value: '500', source: '.outer', inheritedFrom: 'div.outer' },
    ]),
  )
})

it('相等的作者值也能中断继承；显式 inherit 则穿过中间节点', () => {
  const { read } = board(`
    <div id="outer" style="color: green; font-family: serif; line-height: 2">
      <div id="middle" style="color: green; font-family: inherit">
        <span data-target style="line-height: 2"></span>
      </div>
    </div>`)
  const { declarations } = read()
  expect(declarations).toEqual(
    expect.arrayContaining([
      { property: 'line-height', value: '2', source: 'style' },
      { property: 'color', value: 'green', source: 'style', inheritedFrom: 'div#middle' },
      { property: 'font-family', value: 'serif', source: 'style', inheritedFrom: 'div#outer' },
    ]),
  )
  expect(declarations).toHaveLength(3)
})

it('标题继承祖先的文字颜色，沙盒样式覆盖后不再归给该祖先', () => {
  const external = document.createElement('style')
  external.textContent = '.runtime-tone { color: teal }'
  document.body.append(external)
  const { target, read } = board(`
    <article id="cover" style="color: maroon; font-weight: 700">
      <h1 data-target>封面标题</h1>
    </article>`)
  expect(read().declarations).toEqual([
    { property: 'color', value: 'maroon', source: 'style', inheritedFrom: 'article#cover' },
  ])
  target.classList.add('runtime-tone')
  expect(read().declarations).toEqual([])
})

it('冲突选择器、全属性重置和注册状态未知的自定义属性不冒认继承', () => {
  const { read } = board(`
    <style>
      .first { color: red; } .second { color: green; }
      .outer { font-weight: 900; --tone: teal; }
      .reset { all: initial; }
    </style>
    <div class="outer"><div class="reset"><div class="first second">
      <span data-target style="--local: gold"></span>
    </div></div></div>`)
  expect(read()).toEqual({
    layerId: 'selected',
    declarations: [{ property: '--local', value: 'gold', source: 'style' }],
    truncated: true,
  })
})

it('不展示未生效的条件声明，不让字体简写漏过远祖字体', () => {
  const { read } = board(`
    <style>
      .outer { font-family: serif; }
      .middle { font: italic 12px sans-serif; }
      @media not all { .target { color: red; } }
      @supports (unknown-example: no) { .target { color: blue; } }
    </style>
    <div class="outer"><div class="middle">
      <span data-target class="target" style="width: 1px"></span>
    </div></div>`)
  const { declarations } = read()
  expect(declarations).toContainEqual({ property: 'width', value: '1px', source: 'style' })
  expect(declarations.some((d) => d.source === '.outer' || d.property === 'color')).toBe(false)
})

it('沙盒包装器和作品根外的节点不作为祖先来源', () => {
  const { root, target, read } = board(`
    <div data-ak-renderer="html" style="font-weight: 900"><span data-target></span></div>`)
  root.style.color = 'teal'
  expect(read().declarations).toEqual([])
  document.body.append(target)
  expect(read()).toEqual({ layerId: 'selected', declarations: [], truncated: true })
})

it('同名目录按钮只报告自身的行内声明和所在隔离树可读的 CSSOM', () => {
  const { root } = board('<style>.action { padding: 99px }</style><div data-target></div>')
  const buttons = ['11px', '22px'].map((size, i) => {
    const host = document.createElement('section')
    host.style.color = 'teal'
    root.append(host)
    const shadow = host.attachShadow({ mode: 'open' })
    const main = document.createElement('main')
    main.dataset.akSystem = `OriginalControls0${i}`
    main.dataset.akSystemVersion = '1'
    const style = document.createElement('style')
    style.textContent = `.action { height: ${size} }`
    const button = document.createElement('button')
    button.className = 'action'
    button.style.width = size
    main.append(style, button)
    shadow.append(main)
    return { button, style, size }
  })

  for (const { button, style, size } of buttons) {
    const snapshot = readLayerStyles(button, root, 'selected')
    const expected = [{ source: 'style', property: 'width', value: size }]
    // 不把样式文本重新装入文档；未开放隔离树 CSSOM 的环境只能证明行内来源。
    if (style.sheet) expected.push({ source: '.action', property: 'height', value: size })
    expect(snapshot.declarations).toEqual(expected)
    expect(snapshot.truncated).toBe(true)
  }
})

it('SVG 文字保留表现属性原值，继承在表现属性、匹配 CSS 和行内之间按层叠截断', () => {
  const { read } = board(`
    <style>.paint { fill: purple; stroke: teal }</style>
    <svg width="320" height="180" fill="#111">
      <g class="paint" fill="#222" stroke="#000" font-size="18" text-anchor="middle">
        <text data-target stroke="#fff" font-family="sans-serif" font-weight="600">正文</text>
      </g>
    </svg>`)
  const snapshot = read()
  expect(snapshot.truncated).toBe(false)
  expect(snapshot.declarations).toEqual(
    expect.arrayContaining([
      { property: 'stroke', value: '#fff', source: '[stroke]' },
      { property: 'font-weight', value: '600', source: '[font-weight]' },
      { property: 'font-family', value: 'sans-serif', source: '[font-family]' },
      { property: 'font-size', value: '18', source: '[font-size]', inheritedFrom: 'g.paint' },
      {
        property: 'text-anchor',
        value: 'middle',
        source: '[text-anchor]',
        inheritedFrom: 'g.paint',
      },
      { property: 'fill', value: 'purple', source: '.paint', inheritedFrom: 'g.paint' },
    ]),
  )
  expect(snapshot.declarations).toHaveLength(6)
})

it('SVG 祖先的行内覆盖同层表现属性，HTML 同名属性不是表现声明', () => {
  const svg = board(`
    <svg fill="#333"><g fill="#444" style="fill: teal"><text data-target>文字</text></g></svg>`)
  expect(svg.read().declarations).toEqual([
    { property: 'fill', value: 'teal', source: 'style', inheritedFrom: 'g' },
  ])
  const html = board('<div fill="#123"><span data-target stroke="#fff"></span></div>')
  expect(html.read().declarations).toEqual([])
})

it('超过协议数量上限时只发送有来源的完整声明', () => {
  const { target, read } = board('<span data-target></span>')
  target.setAttribute(
    'style',
    Array.from({ length: CANVAS_STYLE_LIMITS.declarations + 3 }, (_, i) => `--v${i}: ${i}`).join(
      ';',
    ),
  )
  const snapshot = read()
  expect(snapshot.declarations).toHaveLength(CANVAS_STYLE_LIMITS.declarations)
  expect(snapshot.truncated).toBe(true)
})
