import type { Messages } from '@/shared/i18n'

export const routeMessages = {
  '正在打开…': ['Wird geöffnet…', 'جارٍ الفتح…', 'Opening…'],
  分享链接已过期: [
    'Dieser Freigabelink ist abgelaufen',
    'انتهت صلاحية رابط المشاركة',
    'This share link has expired',
  ],
  '请向分享者索取新链接。': [
    'Bitten Sie die freigebende Person um einen neuen Link.',
    'اطلب رابطًا جديدًا من الشخص الذي شارك العمل.',
    'Ask the person who shared it for a new link.',
  ],
  请登录后打开: ['Zum Öffnen anmelden', 'سجّل الدخول لفتح العمل', 'Sign in to open this artifact'],
  没有查看权限: [
    'Keine Leseberechtigung',
    'ليس لديك إذن بالعرض',
    'You don’t have permission to view this artifact',
  ],
  作品不可用: ['Das Werk ist nicht verfügbar', 'العمل غير متاح', 'Artifact unavailable'],
  无法打开作品: [
    'Das Werk konnte nicht geöffnet werden',
    'تعذّر فتح العمل',
    'Couldn’t open the artifact',
  ],
  返回作品库: ['Zur Werkbibliothek', 'العودة إلى مكتبة الأعمال', 'Back to library'],
  重试: ['Erneut versuchen', 'إعادة المحاولة', 'Retry'],
  离线: ['Offline', 'غير متصل', 'Offline'],
  '连接已断开，正在重连…': [
    'Verbindung unterbrochen. Verbindung wird wiederhergestellt…',
    'انقطع الاتصال. جارٍ إعادة الاتصال…',
    'Connection lost. Reconnecting…',
  ],
  通知: ['Mitteilungen', 'الإشعارات', 'Notifications'],
  关闭: ['Schließen', 'إغلاق', 'Close'],
} as const satisfies Messages
