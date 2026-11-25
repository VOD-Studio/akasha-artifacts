import type { Messages } from '@/shared/i18n'

/** 纸型名称和 CSS 像素坐标在所有语言下保持相同含义。 */
export const boardPrintMessages = {
  打印与辅助线: ['Druck und Hilfslinien', 'الطباعة والأدلة', 'Print and guides'],
  打印版式: ['Drucklayout', 'تخطيط الطباعة', 'Print layout'],
  固定: ['Fest', 'ثابت', 'Fixed'],
  流式: ['Fließend', 'انسيابي', 'Flow'],
  纸张尺寸: ['Papierformat', 'حجم الورق', 'Paper size'],
  布局辅助线: ['Layout-Hilfslinien', 'أدلة التخطيط', 'Layout guides'],
  辅助线方向: ['Ausrichtung der Hilfslinie', 'اتجاه الدليل', 'Guide direction'],
  垂直: ['Vertikal', 'عمودي', 'Vertical'],
  水平: ['Horizontal', 'أفقي', 'Horizontal'],
  '位置（px）': ['Position (px)', 'الموضع (px)', 'Position (px)'],
  '垂直 · {position} px': [
    'Vertikal · {position} px',
    'عمودي · {position} px',
    'Vertical · {position} px',
  ],
  '水平 · {position} px': [
    'Horizontal · {position} px',
    'أفقي · {position} px',
    'Horizontal · {position} px',
  ],
  添加辅助线: ['Hilfslinie hinzufügen', 'إضافة دليل', 'Add guide'],
  '删除辅助线：{guide}': [
    'Hilfslinie entfernen: {guide}',
    'إزالة الدليل: {guide}',
    'Remove guide: {guide}',
  ],
  此位置已有辅助线: [
    'An dieser Position ist bereits eine Hilfslinie vorhanden.',
    'يوجد دليل بالفعل في هذا الموضع.',
    'A guide already exists at this position.',
  ],
  保存打印设置: ['Druckeinstellungen speichern', 'حفظ إعدادات الطباعة', 'Save print settings'],
  '作品已更新，未保存打印设置。': [
    'Das Werk wurde aktualisiert. Die Druckeinstellungen wurden nicht gespeichert.',
    'تم تحديث العمل. لم تُحفظ إعدادات الطباعة.',
    'The artifact changed. Print settings were not saved.',
  ],
  载入当前设置: [
    'Aktuelle Einstellungen laden',
    'تحميل الإعدادات الحالية',
    'Load current settings',
  ],
} as const satisfies Messages
