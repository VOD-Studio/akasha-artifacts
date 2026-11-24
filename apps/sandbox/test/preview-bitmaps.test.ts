// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { freezePreviewBitmaps } from '../src/renderers/preview-bitmaps'

const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFUlEQVR4nGP8z8Dwn4GBgYEJRIAwAB8XAgICR7MUAAAAAElFTkSuQmCC'
const APNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAACGFjVEwAAAACAAAAAPONk3AAAAAaZmNUTAAAAAAAAAACAAAAAgAAAAAAAAAAAAEACgAA6FTcAAAAABVJREFUeJxj/M/A8J+BgYGBCUSAMAAfFwICAkezFAAAABpmY1RMAAAAAQAAAAIAAAACAAAAAAAAAAAAAQAKAABzJzbUAAAAGWZkQVQAAAACeJxjZGD4/5+BgYGBCUSAMAAdGQICRW6eVwAAAABJRU5ErkJggg=='
const GIF =
  'data:image/gif;base64,R0lGODlhAgACAIEAAP8AAAAAAAAAAAAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQACgAAACwAAAAAAgACAAAIBgABCAQQEAAh+QQBCgABACwAAAAAAgACAIEAAP8AAAAAAAAAAAAIBgABCAQQEAA7'
const GIF_FRAME =
  'data:image/gif;base64,R0lGODlhAgACAIEAAP8AAAAAAAAAAAAAACH5BAAKAAAALAAAAAACAAIAAAgGAAEIBBAQADs='

function fragment(markup: string): DocumentFragment {
  const template = document.createElement('template')
  template.innerHTML = markup
  return template.content
}

afterEach(() => vi.useRealTimers())

describe('设计视图的位图静帧', () => {
  it('保留静态 PNG；GIF 留首帧，APNG 留 PNG 海报并保留响应式候选描述符', () => {
    const content = fragment(`
      <img id="static" src="${PNG}">
      <picture><source srcset="${APNG} 1x, ${GIF} 2x"><img id="poster" src="${APNG}"></picture>
    `)
    expect(freezePreviewBitmaps(content, document, new AbortController().signal)).toBeUndefined()
    expect(content.querySelector('#static')?.getAttribute('src')).toBe(PNG)
    expect(content.querySelector('#poster')?.getAttribute('src')).toBe(PNG)
    expect(content.querySelector('source')?.getAttribute('srcset')).toBe(
      `${PNG} 1x, ${GIF_FRAME} 2x`,
    )
  })

  it('处理样式表、伪元素、image-set、内联样式及 SVG image，保留本地片段和字体', () => {
    const content = fragment(`
      <style>
        @import 'unknown.css';
        @font-face { font-family: sample; src: url('font.woff2') }
        .photo::before { background: image-set("${GIF}" 1x, url(${APNG}) 2x); content: 'url(text)'; }
      </style>
      <div style="background: u\\72 l(${GIF})"></div>
      <svg><defs><clipPath id="crop" /></defs>
        <image href="${APNG}" clip-path="url(#crop)" />
        <filter><feImage id="filtered-image" xlink:href="${GIF}" /></filter>
      </svg>
    `)
    freezePreviewBitmaps(content, document, new AbortController().signal)
    expect(content.querySelector('style')?.textContent).toContain(
      `image-set("${GIF_FRAME}" 1x, url("${PNG}") 2x)`,
    )
    expect(content.querySelector('style')?.textContent).toContain("src: url('font.woff2')")
    expect(content.querySelector('style')?.textContent).toContain("content: 'url(text)'")
    expect(content.querySelector('style')?.textContent).not.toContain('@import')
    expect(content.querySelector('div')?.getAttribute('style')).toBe(
      `background: url("${GIF_FRAME}")`,
    )
    expect(content.querySelector('image')?.getAttribute('href')).toBe(PNG)
    expect(content.querySelector('image')?.getAttribute('clip-path')).toBe('url(#crop)')
    expect(
      content
        .querySelector('#filtered-image')
        ?.getAttributeNS('http://www.w3.org/1999/xlink', 'href'),
    ).toBe(GIF_FRAME)
  })

  it('媒体不受允许的源或解码超时时，只留下静态占位，不回退原始素材', async () => {
    vi.useFakeTimers()
    const unknown = 'data:image/svg+xml,%3Csvg%3E'
    const content = fragment(`<img src="${unknown}"><img src="https://example.test/animated.gif">`)
    const finalized = freezePreviewBitmaps(content, document, new AbortController().signal)
    await vi.advanceTimersByTimeAsync(1200)
    await finalized
    const [timedOut, disallowed] = content.querySelectorAll('img')
    expect(timedOut.getAttribute('src')).toMatch(/^data:image\/gif;base64,/)
    expect(disallowed.getAttribute('src')).toBe(timedOut.getAttribute('src'))
  })
})
