import { injectHtmlLocations } from '@akasha/jsx-source'
import { useEffect, useRef } from 'react'
import { sanitizeMarkup } from '../sanitize'

export function SanitizedHtmlBox({ html, className }: { html: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!ref.current) return
    const instrumented = injectHtmlLocations(html).code
    ref.current.innerHTML = sanitizeMarkup(instrumented, 'html')
  }, [html])
  return <div ref={ref} className={className} />
}
