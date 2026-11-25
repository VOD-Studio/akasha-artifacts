import type { Messages } from '@/shared/i18n'

export const messages = {
  已撤下: ['Zurückgezogene Werke', 'الأعمال المسحوبة', 'Withdrawn artifacts'],
  已恢复: ['Wiederhergestellt', 'تمت الاستعادة', 'Restored'],
  '恢复「{title}」？': [
    '„{title}“ wiederherstellen?',
    'هل تريد استعادة «{title}»؟',
    'Restore “{title}”?',
  ],
  '旧分享链接不会恢复。': [
    'Alte Freigabelinks werden nicht wiederhergestellt.',
    'لن تتم استعادة روابط المشاركة السابقة.',
    'Previous share links will not be restored.',
  ],
  返回: ['Zurück', 'رجوع', 'Back'],
  恢复: ['Wiederherstellen', 'استعادة', 'Restore'],
  '加载中…': ['Wird geladen…', 'جارٍ التحميل…', 'Loading…'],
  没有已撤下的作品: [
    'Keine zurückgezogenen Werke',
    'لا توجد أعمال مسحوبة',
    'No withdrawn artifacts',
  ],
} as const satisfies Messages
