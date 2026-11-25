import type { Messages } from '@/shared/i18n'

export const messages = {
  存储用量: ['Speicherbelegung', 'استخدام التخزين', 'Storage usage'],
  '仅统计运行数据，不含源码与版本。': [
    'Nur Laufzeitdaten, ohne Quellcode und Versionen.',
    'تشمل الإحصاءات بيانات التشغيل فقط، دون الشيفرة والإصدارات.',
    'Runtime data only. Source code and versions are excluded.',
  ],
  关闭: ['Schließen', 'إغلاق', 'Close'],
  正在加载用量: [
    'Speicherbelegung wird geladen',
    'جارٍ تحميل استخدام التخزين',
    'Loading storage usage',
  ],
  共享: ['Gemeinsam', 'مشترك', 'Shared'],
  个人: ['Persönlich', 'شخصي', 'Personal'],
  重命名: ['Umbenennen', 'إعادة التسمية', 'Rename'],
  已撤下: ['Zurückgezogen', 'سُحب العمل', 'Withdrawn'],
  '撤下「{title}」？': ['„{title}“ zurückziehen?', 'هل تريد سحب «{title}»؟', 'Withdraw “{title}”?'],
  '可在作品库恢复。旧分享链接永久失效。': [
    'In der Bibliothek wiederherstellbar. Bisherige Freigabelinks werden dauerhaft ungültig.',
    'يمكن استعادته من المكتبة. ستبطل روابط المشاركة السابقة نهائيًا.',
    'You can restore it from the library. Existing share links will stop working permanently.',
  ],
  取消: ['Abbrechen', 'إلغاء', 'Cancel'],
  撤下: ['Zurückziehen', 'سحب', 'Withdraw'],
  保存: ['Speichern', 'حفظ', 'Save'],
  名称: ['Name', 'الاسم', 'Name'],
} as const satisfies Messages
