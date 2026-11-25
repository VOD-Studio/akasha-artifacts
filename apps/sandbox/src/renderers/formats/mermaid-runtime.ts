import mermaid from 'mermaid'

let mermaidInitialized = false

export function ensureMermaid(): void {
  if (mermaidInitialized) return
  mermaidInitialized = true
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: 'neutral',
  })
}
