import type { Messages } from '@/shared/i18n'

export const messages = {
  作品: ['Werke', 'الأعمال', 'Artifacts'],
  项目: ['Projekte', 'المشاريع', 'Projects'],
  操作: ['Aktionen', 'الإجراءات', 'Actions'],
  休眠: ['Ruhend', 'خامل', 'Dormant'],
  打开作品库: ['Bibliothek öffnen', 'فتح مكتبة الأعمال', 'Open library'],
  '搜索作品、项目或操作…': [
    'Werke, Projekte oder Aktionen suchen…',
    'البحث عن أعمال أو مشاريع أو إجراءات…',
    'Search artifacts, projects, or actions…',
  ],
  命令面板: ['Befehlspalette', 'لوحة الأوامر', 'Command palette'],
  '在「{label}」里搜索': ['In „{label}“ suchen', 'البحث في «{label}»', 'Search in “{label}”'],
  正在搜索全文: ['Volltextsuche läuft', 'جارٍ البحث في النص الكامل', 'Searching full text'],
  结果: ['Ergebnisse', 'النتائج', 'Results'],
  全文: ['Volltext', 'النص الكامل', 'Full text'],
  没有找到结果: ['Keine Ergebnisse', 'لا توجد نتائج', 'No results found'],
  '试试在全文里搜索。': [
    'Versuchen Sie es mit der Volltextsuche.',
    'جرّب البحث في النص الكامل.',
    'Try a full-text search.',
  ],
  '试试其他关键词。': [
    'Versuchen Sie andere Suchbegriffe.',
    'جرّب كلمات بحث أخرى.',
    'Try another keyword.',
  ],
  在全文里搜索: ['Im Volltext suchen', 'البحث في النص الكامل', 'Search full text'],
  选择: ['Auswählen', 'اختيار', 'Select'],
  打开: ['Öffnen', 'فتح', 'Open'],
  新标签打开: ['In neuem Tab öffnen', 'فتح في علامة تبويب جديدة', 'Open in new tab'],
  '{count} 项': [
    { one: '{count} Eintrag', other: '{count} Einträge' },
    {
      zero: 'لا عناصر',
      one: 'عنصر واحد',
      two: 'عنصران',
      few: '{count} عناصر',
      many: '{count} عنصرًا',
      other: '{count} عنصر',
    },
    { one: '{count} item', other: '{count} items' },
  ],
} as const satisfies Messages
