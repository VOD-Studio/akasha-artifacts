import { describe, expect, it } from 'vitest'
import { applyVisualEdit, inspectVisualTarget } from '../src/edit.js'
import { injectHtmlLocations, injectJsxLocations } from '../src/index.js'

function reactLoc(source: string, tag: string, index = 0): string {
  return (
    injectJsxLocations(source).locations.filter((item) => item.tagName === tag)[index]?.loc ?? ''
  )
}

describe('可视化直改源码', () => {
  it('保留 JSX 原有格式、制表符、尾随换行及与改动无关的字面量', () => {
    const source =
      "export default () => (\r\n\t<div>\r\n\t\t<p id='heading' className='text-sm'>标题</p>\r\n\t</div>\r\n)\r\n"
    const loc = reactLoc(source, 'p')
    expect(inspectVisualTarget('react', source, loc)).toMatchObject({
      text: '标题',
      className: 'text-sm',
    })
    expect(applyVisualEdit('react', source, { kind: 'text', loc, value: '新标题' })).toBe(
      source.replace('标题', '新标题'),
    )
    expect(
      applyVisualEdit('react', source, {
        kind: 'className',
        loc,
        value: 'text-[12px] hover:font-bold',
      }),
    ).toBe(source.replace('text-sm', 'text-[12px] hover:font-bold'))
    const literal = applyVisualEdit('react', source, { kind: 'text', loc, value: '<b>{value}</b>' })
    expect(inspectVisualTarget('react', literal, loc)).toMatchObject({ text: '<b>{value}</b>' })
  })

  it('按直接兄弟顺序移动 JSX 节点，保留注释及未修改的格式', () => {
    const source =
      'export default () => <ul>\n  <li>A</li>\n  {/* 分隔注释 */}\n  <li>B</li>\n  <li>C</li>\n</ul>'
    const loc = reactLoc(source, 'li')
    const targetParentLoc = reactLoc(source, 'ul')
    expect(inspectVisualTarget('react', source, loc)).toMatchObject({
      order: {
        parentLoc: targetParentLoc,
        siblings: [{ label: 'A' }, { label: 'B' }, { label: 'C' }],
      },
    })
    expect(applyVisualEdit('react', source, { kind: 'move', loc, targetParentLoc, index: 2 })).toBe(
      'export default () => <ul>\n  <li>B</li>\n  {/* 分隔注释 */}\n  <li>C</li>\n  <li>A</li>\n</ul>',
    )
    expect(applyVisualEdit('react', source, { kind: 'remove', loc: targetParentLoc })).toBe(
      'export default () => null',
    )
  })

  it('拒绝动态表达式、条件、循环、展开属性、组件子节点和伪造 loc', () => {
    const source = `export default function App() {
      return <main><p>{name}</p>{show && <b>条件</b>}{data.map(x => <i key={x}>重复</i>)}<Widget><strong>插槽</strong></Widget><span {...props}>展开</span><u data-ak-loc="1:1">伪造</u><small>静态</small></main>
    }`
    for (const tag of ['p', 'b', 'i', 'strong', 'span', 'u']) {
      const loc = reactLoc(source, tag)
      expect(inspectVisualTarget('react', source, loc)).toBeNull()
      expect(() => applyVisualEdit('react', source, { kind: 'remove', loc })).toThrow()
    }
    const loc = reactLoc(source, 'small')
    expect(inspectVisualTarget('react', source, loc)).toMatchObject({ text: '静态', order: null })
    expect(() =>
      applyVisualEdit('react', source, {
        kind: 'move',
        loc,
        targetParentLoc: reactLoc(source, 'main'),
        index: 0,
      }),
    ).toThrow()
  })

  it('编辑 HTML 文档原文，识别实体并在引号内安全写回', () => {
    const source =
      "<!doctype html>\n<section>\n  <p class='text-sm'>A &amp; B</p>\n  <p>第二段</p>\n</section>\n"
    const [parent, first, second] = injectHtmlLocations(source).locations.map((item) => item.loc)
    expect(inspectVisualTarget('html', source, first ?? '')).toMatchObject({
      text: 'A & B',
      className: 'text-sm',
    })
    expect(applyVisualEdit('html', source, { kind: 'text', loc: first ?? '', value: '<b>&' })).toBe(
      source.replace('A &amp; B', '&lt;b&gt;&amp;'),
    )
    expect(
      applyVisualEdit('html', source, {
        kind: 'className',
        loc: first ?? '',
        value: "before:content-['hi']",
      }),
    ).toBe(source.replace('text-sm', 'before:content-[&#39;hi&#39;]'))
    expect(
      applyVisualEdit('html', source, {
        kind: 'move',
        loc: second ?? '',
        targetParentLoc: parent ?? '',
        index: 0,
      }),
    ).toBe(
      "<!doctype html>\n<section>\n  <p>第二段</p>\n  <p class='text-sm'>A &amp; B</p>\n</section>\n",
    )
    expect(applyVisualEdit('html', source, { kind: 'remove', loc: second ?? '' })).toBe(
      source.replace('<p>第二段</p>', ''),
    )
    expect(inspectVisualTarget('markdown', source, first ?? '')).toBeNull()
  })
})
