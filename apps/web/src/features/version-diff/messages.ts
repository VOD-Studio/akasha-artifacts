import type { Messages } from '@/shared/i18n'

export const messages = {
  '新增 {count} 行': [
    { one: '{count} Zeile hinzugefügt', other: '{count} Zeilen hinzugefügt' },
    {
      zero: 'لم تُضف أي أسطر',
      one: 'أُضيف سطر واحد',
      two: 'أُضيف سطران',
      few: 'أُضيفت {count} أسطر',
      many: 'أُضيف {count} سطرًا',
      other: 'أُضيف {count} سطر',
    },
    { one: '{count} line added', other: '{count} lines added' },
  ],
  '删除 {count} 行': [
    { one: '{count} Zeile entfernt', other: '{count} Zeilen entfernt' },
    {
      zero: 'لم تُحذف أي أسطر',
      one: 'حُذف سطر واحد',
      two: 'حُذف سطران',
      few: 'حُذفت {count} أسطر',
      many: 'حُذف {count} سطرًا',
      other: 'حُذف {count} سطر',
    },
    { one: '{count} line removed', other: '{count} lines removed' },
  ],
  暂无可比较的版本: [
    'Keine Versionen zum Vergleichen',
    'لا توجد إصدارات للمقارنة',
    'No versions to compare',
  ],
  版本对比: ['Versionsvergleich', 'مقارنة الإصدارات', 'Compare versions'],
  基准版本: ['Ausgangsversion', 'الإصدار الأساسي', 'Base version'],
  目标版本: ['Zielversion', 'الإصدار المستهدف', 'Target version'],
  '无法读取对比版本：{error}': [
    'Vergleichsversion konnte nicht geladen werden: {error}',
    'تعذّر تحميل الإصدار للمقارنة: {error}',
    'Could not load comparison version: {error}',
  ],
  重试: ['Erneut versuchen', 'إعادة المحاولة', 'Retry'],
  '正在读取对比版本…': [
    'Vergleichsversionen werden geladen…',
    'جارٍ تحميل إصدارات المقارنة…',
    'Loading comparison versions…',
  ],
  源码没有变化: [
    'Keine Änderungen am Quellcode',
    'لا توجد تغييرات في الشفرة المصدرية',
    'No source changes',
  ],
} as const satisfies Messages
