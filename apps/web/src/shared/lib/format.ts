import type { ArtifactType } from '@akasha/protocol'

export const ARTIFACT_TYPE_LABELS: Record<ArtifactType, string> = {
  react: 'React',
  html: 'HTML',
  markdown: 'Markdown',
  mermaid: 'Mermaid',
  svg: 'SVG',
  artboard: '画板对比',
  document: '设计文档',
  verify: '交付验收',
  'pr-walkthrough': 'PR 走查',
  'live-timeline': '实时时间线',
  'option-compare': '方案对比',
  'data-story': '数据故事',
}

export function formatRelativeTime(iso: string, nowMs = Date.now()): string {
  const ts = Date.parse(iso)
  if (Number.isNaN(ts)) return iso
  const diffSec = Math.max(0, Math.floor((nowMs - ts) / 1000))
  if (diffSec < 10) return '刚刚'
  if (diffSec < 60) return `${diffSec} 秒前`
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin} 分钟前`
  const diffHour = Math.floor(diffMin / 60)
  if (diffHour < 24) return `${diffHour} 小时前`
  const diffDay = Math.floor(diffHour / 24)
  if (diffDay < 30) return `${diffDay} 天前`
  return new Date(ts).toLocaleDateString('zh-CN')
}

export function formatUptime(uptimeSec: number): string {
  if (uptimeSec < 60) return `${uptimeSec}s`
  const mins = Math.floor(uptimeSec / 60)
  if (mins < 60) return `${mins}m ${uptimeSec % 60}s`
  const hours = Math.floor(mins / 60)
  return `${hours}h ${mins % 60}m`
}
