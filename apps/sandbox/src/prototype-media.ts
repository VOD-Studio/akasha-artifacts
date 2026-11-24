function keepEmbeddedSource(element: Element, playback: boolean): boolean {
  const src = element.getAttribute('src')
  if (src === null) return false
  if (playback) {
    const url = src.trim()
    if (/^(?:data|blob):/i.test(url)) {
      if (url !== src) element.setAttribute('src', url)
      return true
    }
  }
  element.removeAttribute('src')
  return false
}

/** 在插入已净化的惰性 HTML 片段前处理媒体。设计预览仅保留封面；试玩只允许通过原生控件启动内嵌媒体。 */
export function preparePrototypeMedia(fragment: ParentNode, playback: boolean): void {
  for (const media of fragment.querySelectorAll('audio, video')) {
    if (media.namespaceURI !== 'http://www.w3.org/1999/xhtml') continue
    media.removeAttribute('autoplay')
    let hasSource = keepEmbeddedSource(media, playback)
    for (const child of media.children) {
      if (child.localName === 'source') hasSource = keepEmbeddedSource(child, playback) || hasSource
      else if (child.localName === 'track') keepEmbeddedSource(child, playback)
    }
    media.toggleAttribute('controls', hasSource)
  }
}
