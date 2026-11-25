import type { Messages } from '@/shared/i18n'

/** 只写入导出时所选语言；页面、画板和流程的作者文案不进入词表。 */
export const previewMessages = {
  离线预览: ['Offline-Vorschau', 'معاينة دون اتصال', 'Offline preview'],
  页面: ['Seite', 'الصفحة', 'Page'],
  画板: ['Zeichenfläche', 'لوحة الرسم', 'Artboard'],
  总览: ['Übersicht', 'نظرة عامة', 'Overview'],
  未分组: ['Nicht gruppiert', 'غير مجمّعة', 'Ungrouped'],
  跳转画板: ['Zu einer Zeichenfläche wechseln', 'الانتقال إلى لوحة رسم', 'Artboard navigation'],
  '此页面没有画板。': [
    'Diese Seite enthält keine Zeichenflächen.',
    'لا توجد لوحات رسم في هذه الصفحة.',
    'This page has no artboards.',
  ],
  '正在打开…': ['Wird geöffnet…', 'جارٍ الفتح…', 'Opening…'],
  '画板内容：{title}': [
    'Inhalt der Zeichenfläche: {title}',
    'محتوى لوحة الرسم: {title}',
    'Artboard content: {title}',
  ],
  '前往 {title}': ['Zu {title} wechseln', 'الانتقال إلى {title}', 'Go to {title}'],
  '无法打开画板：{error}': [
    'Zeichenfläche lässt sich nicht öffnen: {error}',
    'تعذّر فتح لوحة الرسم: {error}',
    'Cannot open artboard: {error}',
  ],
  '当前画板无法跳转到该目标。': [
    'Dieses Ziel ist von der aktuellen Zeichenfläche aus nicht erreichbar.',
    'لا يمكن الانتقال إلى هذه الوجهة من لوحة الرسم الحالية.',
    'This destination cannot be reached from the current artboard.',
  ],
} as const satisfies Messages
