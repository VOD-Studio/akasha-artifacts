import type { Messages } from '@/shared/i18n'

export const panelMessages = {
  没有编辑权限: [
    'Keine Berechtigung zum Bearbeiten',
    'ليس لديك إذن بالتعديل',
    'You do not have permission to edit',
  ],
  无法更新运行参数: [
    'Laufzeitparameter konnten nicht aktualisiert werden',
    'تعذّر تحديث معلمات التشغيل',
    'Could not update runtime parameters',
  ],
  运行参数: ['Laufzeitparameter', 'معلمات التشغيل', 'Runtime parameters'],
  无法加载运行参数: [
    'Laufzeitparameter konnten nicht geladen werden',
    'تعذّر تحميل معلمات التشغيل',
    'Could not load runtime parameters',
  ],
  没有可调整的参数: [
    'Keine einstellbaren Parameter',
    'لا توجد معلمات قابلة للضبط',
    'No adjustable parameters',
  ],
  打开批注: ['Kommentare öffnen', 'فتح التعليقات', 'Open comments'],
  重置: ['Zurücksetzen', 'إعادة ضبط', 'Reset'],
} as const satisfies Messages
