import type { Messages } from '@/shared/i18n'

export const messages = {
  新建设计: ['Neues Design', 'تصميم جديد', 'New design'],
  重试: ['Erneut versuchen', 'إعادة المحاولة', 'Retry'],
  项目: ['Projekt', 'المشروع', 'Project'],
  登录本机作品库: [
    'Bei der lokalen Bibliothek anmelden',
    'تسجيل الدخول إلى مكتبة الأعمال المحلية',
    'Sign in to the local library',
  ],
  无权新建设计: [
    'Keine Berechtigung zum Erstellen von Designs',
    'ليس لديك إذن لإنشاء تصميم',
    'You do not have permission to create a design',
  ],
  '无法读取 Agent 连接': [
    'Agent-Verbindungen konnten nicht geladen werden',
    'تعذر تحميل اتصالات الوكيل',
    'Could not load agent connections',
  ],
  '在项目目录连接 Codex': [
    'Codex im Projektverzeichnis verbinden',
    'اربط Codex في مجلد المشروع',
    'Connect Codex in the project directory',
  ],
  'Codex 正忙': ['Codex ist beschäftigt', 'Codex مشغول', 'Codex is busy'],
  没有已受理的设计会话: [
    'Keine angenommene Designsitzung',
    'لا توجد جلسة تصميم مقبولة',
    'No accepted design session',
  ],
  关闭: ['Schließen', 'إغلاق', 'Close'],
  打开设计: ['Design öffnen', 'فتح التصميم', 'Open design'],
  返回编辑: ['Zurück zur Bearbeitung', 'العودة إلى التحرير', 'Back to editing'],
  发送: ['Senden', 'إرسال', 'Send'],
  选择项目: ['Projekt auswählen', 'اختيار مشروع', 'Select a project'],
  无项目: ['Keine Projekte', 'لا توجد مشاريع', 'No projects'],
  '发布 Agent': ['Agent für die Veröffentlichung', 'وكيل النشر', 'Publishing agent'],
  '选择 Agent': ['Agent auswählen', 'اختيار وكيل', 'Select an agent'],
  '本机 Codex': ['Lokaler Codex', 'Codex المحلي', 'Local Codex'],
  设计需求: ['Designauftrag', 'متطلبات التصميم', 'Design brief'],
  '提交失败：{reason}': [
    'Senden fehlgeschlagen: {reason}',
    'تعذر الإرسال: {reason}',
    'Could not submit: {reason}',
  ],
  会话已失效: ['Sitzung abgelaufen', 'انتهت صلاحية الجلسة', 'Session has expired'],
  无法读取会话: [
    'Sitzung konnte nicht geladen werden',
    'تعذر تحميل الجلسة',
    'Could not load session',
  ],
  '正在读取会话…': ['Sitzung wird geladen…', 'جارٍ تحميل الجلسة…', 'Loading session…'],
} as const satisfies Messages
