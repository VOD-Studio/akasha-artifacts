import type { Artifact, Version } from '@akasha/protocol'
import { DropdownMenuItem } from '@akasha/ui/dropdown-menu'
import { Download } from 'lucide-react'
import { toast } from 'sonner'

interface ExportHtmlMenuItemProps {
  artifact: Artifact
  version: Version
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// 生成自包含的离线单文件 HTML 快照，便于归档或邮件/IM 分享。
function buildStandaloneHtml(artifact: Artifact, version: Version): string {
  const safeTitle = escapeHtml(`${artifact.title} (v${version.version})`)
  if (artifact.type === 'html' || artifact.type === 'document') {
    if (/<html\b/i.test(version.source)) {
      return version.source
    }
    return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${safeTitle}</title>
  <style>body{margin:0;padding:24px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#0f172a;background:#fff;}</style>
</head>
<body>
${version.source}
</body>
</html>`
  }

  if (artifact.type === 'svg') {
    return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <title>${safeTitle}</title>
  <style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#fff;}</style>
</head>
<body>
${version.source}
</body>
</html>`
  }

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${safeTitle}</title>
  <style>
    body{margin:0;padding:24px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#0f172a;background:#f8fafc;}
    .card{max-width:960px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:20px;}
    pre{overflow:auto;background:#0f172a;color:#f8fafc;padding:16px;border-radius:8px;font-size:13px;line-height:1.5;}
    .meta{font-size:12px;color:#64748b;margin-bottom:12px;}
  </style>
</head>
<body>
  <div class="card">
    <h1>${safeTitle}</h1>
    <div class="meta">Type: ${escapeHtml(artifact.type)} · Public ID: ${escapeHtml(artifact.publicId)} · Author: ${escapeHtml(version.author)} · Exported by Akasha</div>
    <pre><code>${escapeHtml(version.source)}</code></pre>
  </div>
</body>
</html>`
}

export function ExportHtmlMenuItem({ artifact, version }: ExportHtmlMenuItemProps) {
  const handleExport = () => {
    const html = buildStandaloneHtml(artifact, version)
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${artifact.slug.replace(/[^a-zA-Z0-9_-]/g, '-')}-v${version.version}.html`
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
    toast.success(`已导出 ${link.download}`)
  }

  return (
    <DropdownMenuItem onSelect={handleExport}>
      <Download size={14} />
      导出 HTML
    </DropdownMenuItem>
  )
}
