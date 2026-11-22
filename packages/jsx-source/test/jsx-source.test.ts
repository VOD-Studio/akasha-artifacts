import { describe, expect, it } from 'vitest'
import { injectHtmlLocations, injectJsxLocations, validateBlockIds } from '../src/index.js'

describe('@akasha/jsx-source 源码位置注入与块标识校验', () => {
  it('为静态 JSX、.map() 动态节点与带 blockId 的块注入准确的 1-based line:col 且跳过 Fragment', () => {
    const source = [
      'import { Fragment } from "react"',
      'export default function App() {',
      '  const items = ["a", "b"]',
      '  return (',
      '    <Fragment>',
      '      <section data-ak-block="hero">',
      '        <h1>标题</h1>',
      '        <ul>',
      '          {items.map((x) => (',
      '            <li key={x}>{x}</li>',
      '          ))}',
      '        </ul>',
      '      </section>',
      '    </Fragment>',
      '  )',
      '}',
    ].join('\n')

    const res = injectJsxLocations(source)

    expect(res.code).not.toContain('<Fragment data-ak-loc')
    expect(res.code).toContain('<section data-ak-loc="6:7" data-ak-block="hero">')
    expect(res.code).toContain('<h1 data-ak-loc="7:9">标题</h1>')
    expect(res.code).toContain('<li data-ak-loc="10:13" data-ak-dynamic="true" key={x}>{x}</li>')

    const heroLoc = res.locations.find((l) => l.tagName === 'section')
    expect(heroLoc).toMatchObject({ loc: '6:7', blockId: 'hero', dynamic: false })

    const liLoc = res.locations.find((l) => l.tagName === 'li')
    expect(liLoc).toMatchObject({ loc: '10:13', dynamic: true })

    expect(res.blocks).toHaveLength(1)
    expect(res.blocks[0]).toMatchObject({ blockId: 'hero', line: 6, sourceAttr: 'data-ak-block' })

    // 剥离 data-ak-* 属性后应与原始源码逐字符一致，确保注入不改变结构与渲染结果
    const stripped = res.code.replace(/\sdata-ak-(?:loc|dynamic)="[^"]*"/g, '')
    expect(stripped).toBe(source)
  })

  it('为 HTML 片段与完整 HTML 文档注入准确 data-ak-loc 并检测重复 blockId', () => {
    const html = [
      '<article>',
      '  <h1 id="title">设计文档</h1>',
      '  <p data-ak-block="p1">第一段</p>',
      '  <input type="range" value="50" />',
      '  <p data-ak-block="p1">重复块</p>',
      '</article>',
    ].join('\n')

    const res = injectHtmlLocations(html)
    expect(res.code).toContain('<article data-ak-loc="1:1">')
    expect(res.code).toContain('<h1 id="title" data-ak-loc="2:3">设计文档</h1>')
    expect(res.code).toContain('<p data-ak-block="p1" data-ak-loc="3:3">第一段</p>')
    expect(res.code).toContain('<input type="range" value="50" data-ak-loc="4:3" />')

    // 剥离 data-ak-loc 后应与原 HTML 逐字符一致
    expect(res.code.replace(/\sdata-ak-loc="[^"]*"/g, '')).toBe(html)

    const diagnostics = validateBlockIds(res.blocks)
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]).toMatchObject({
      severity: 'error',
      code: 'DUPLICATE_BLOCK_ID',
      line: 5,
    })
  })
})
