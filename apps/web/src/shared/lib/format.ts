import type { ArtifactType } from '@akasha/protocol'
import { getMessages, type Locale, type Messages } from '@/shared/i18n'

const messages = {
  设计: ['Design', 'تصميم', 'Design'],
  设计系统: ['Designsystem', 'نظام التصميم', 'Design system'],
  文档: ['Dokument', 'مستند', 'Document'],
  交付验收: ['Abnahme', 'التحقق من التسليم', 'Delivery review'],
  'PR 走查': ['PR-Durchsicht', 'مراجعة طلب الدمج', 'PR walkthrough'],
  实时时间线: ['Live-Zeitleiste', 'الخط الزمني المباشر', 'Live timeline'],
  方案对比: ['Variantenvergleich', 'مقارنة البدائل', 'Option comparison'],
  数据故事: ['Datengeschichte', 'قصة بيانات', 'Data story'],
  刚刚: ['Gerade eben', 'الآن', 'Just now'],
} as const satisfies Messages

const typeLabels = {
  react: 'React',
  html: 'HTML',
  markdown: 'Markdown',
  mermaid: 'Mermaid',
  svg: 'SVG',
  artboard: '设计',
  'design-system': '设计系统',
  document: '文档',
  verify: '交付验收',
  'pr-walkthrough': 'PR 走查',
  'live-timeline': '实时时间线',
  'option-compare': '方案对比',
  'data-story': '数据故事',
} as const satisfies Record<ArtifactType, string>

export function artifactTypeLabel(type: ArtifactType, locale?: Locale): string {
  switch (type) {
    case 'react':
    case 'html':
    case 'markdown':
    case 'mermaid':
    case 'svg':
      return typeLabels[type]
    default:
      return getMessages(messages, locale).t(typeLabels[type])
  }
}

const relativeFormatters = new Map<Locale, Intl.RelativeTimeFormat>()

function relativeFormatter(locale: Locale) {
  let formatter = relativeFormatters.get(locale)
  if (!formatter) {
    formatter = new Intl.RelativeTimeFormat(locale === 'ar' ? 'ar-u-nu-arab' : locale)
    relativeFormatters.set(locale, formatter)
  }
  return formatter
}

export function formatRelativeTime(iso: string, nowMs = Date.now(), locale?: Locale): string {
  const ts = Date.parse(iso)
  if (Number.isNaN(ts)) return iso
  const diffSec = Math.max(0, Math.floor((nowMs - ts) / 1000))
  const language = getMessages(messages, locale)
  if (diffSec < 10) return language.t('刚刚')
  const formatter = relativeFormatter(language.locale)
  if (diffSec < 60) return formatter.format(-diffSec, 'second')
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return formatter.format(-diffMin, 'minute')
  const diffHour = Math.floor(diffMin / 60)
  if (diffHour < 24) return formatter.format(-diffHour, 'hour')
  const diffDay = Math.floor(diffHour / 24)
  if (diffDay < 30) return formatter.format(-diffDay, 'day')
  return language.date(new Date(ts))
}

export function formatUptime(uptimeSec: number, locale?: Locale): string {
  const { number } = getMessages(messages, locale)
  const unit = (value: number, unit: string) =>
    number(value, { style: 'unit', unit, unitDisplay: 'short' })
  if (uptimeSec < 60) return unit(uptimeSec, 'second')
  const mins = Math.floor(uptimeSec / 60)
  if (mins < 60) return `${unit(mins, 'minute')} ${unit(uptimeSec % 60, 'second')}`
  return `${unit(Math.floor(mins / 60), 'hour')} ${unit(mins % 60, 'minute')}`
}
