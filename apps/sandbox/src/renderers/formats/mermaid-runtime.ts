import mermaid from 'mermaid'

let mermaidInitialized = false

/** 渲染器和 Markdown 预览共用同一份严格配置；图表只能由调用方显式渲染。 */
export function ensureMermaid(): void {
  if (mermaidInitialized) return
  mermaidInitialized = true
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: 'neutral',
  })
}
