import type { Messages } from '@/shared/i18n'

export const messages = {
  本地直连: ['Lokale Direktverbindung', 'اتصال محلي مباشر', 'Direct local connection'],
  已连接云端: ['Mit der Cloud verbunden', 'متصل بالسحابة', 'Connected to cloud'],
  云端连接不稳定: [
    'Cloud-Verbindung instabil',
    'الاتصال بالسحابة غير مستقر',
    'Cloud connection unstable',
  ],
  云端连接受限: [
    'Cloud-Verbindung eingeschränkt',
    'الاتصال بالسحابة محدود',
    'Cloud connection limited',
  ],
  本地服务离线: ['Lokaler Dienst offline', 'الخدمة المحلية غير متصلة', 'Local service offline'],
  本地服务重连中: [
    'Lokaler Dienst verbindet sich erneut',
    'جارٍ إعادة الاتصال بالخدمة المحلية',
    'Reconnecting to local service',
  ],
  本地服务: ['Lokaler Dienst', 'الخدمة المحلية', 'Local service'],
  '正在连接本地服务…': [
    'Verbindung zum lokalen Dienst wird hergestellt…',
    'جارٍ الاتصال بالخدمة المحلية…',
    'Connecting to local service…',
  ],
  无法读取本地服务状态: [
    'Status des lokalen Dienstes nicht verfügbar',
    'تعذّر قراءة حالة الخدمة المحلية',
    'Local service status unavailable',
  ],
  已请求停止本地服务: [
    'Stopp des lokalen Dienstes angefordert',
    'أُرسل طلب إيقاف الخدمة المحلية',
    'Local service stop requested',
  ],
  停止本地服务失败: [
    'Lokaler Dienst konnte nicht gestoppt werden',
    'تعذّر إيقاف الخدمة المحلية',
    'Could not stop local service',
  ],
  '版本 / PID：': ['Version / PID: ', 'الإصدار / معرّف العملية: ', 'Version / PID: '],
  '运行时长：': ['Laufzeit: ', 'مدة التشغيل: ', 'Uptime: '],
  '网页 / 沙盒端口：': [
    'Web- / Sandbox-Port: ',
    'منفذ الويب / البيئة المعزولة: ',
    'Web / sandbox ports: ',
  ],
  '连接数 / 项目数：': [
    'Verbindungen / Projekte: ',
    'الاتصالات / المشاريع: ',
    'Connections / projects: ',
  ],
  '无法连接本地服务。在终端运行': [
    'Lokaler Dienst nicht erreichbar. Im Terminal ausführen:',
    'تعذّر الاتصال بالخدمة المحلية. نفّذ في الطرفية:',
    'Cannot connect to the local service. Run in a terminal:',
  ],
  日志: ['Protokoll', 'السجل', 'Logs'],
  按项目筛选日志: [
    'Protokoll nach Projekt filtern',
    'تصفية السجل حسب المشروع',
    'Filter logs by project',
  ],
  全部项目: ['Alle Projekte', 'كل المشاريع', 'All projects'],
  本地服务日志: ['Protokoll des lokalen Dienstes', 'سجل الخدمة المحلية', 'Local service logs'],
  暂无日志: ['Keine Einträge', 'لا توجد إدخالات', 'No log entries'],
  '正在读取日志…': ['Protokoll wird geladen…', 'جارٍ تحميل السجل…', 'Loading logs…'],
  无法读取日志: [
    'Protokoll konnte nicht geladen werden',
    'تعذّر تحميل السجل',
    'Could not load logs',
  ],
  '本机作品将无法访问，直至重新启动服务。': [
    'Lokale Werke sind erst wieder erreichbar, wenn der Dienst neu gestartet wird.',
    'لن تتوفر الأعمال المحلية حتى إعادة تشغيل الخدمة.',
    'Local artifacts will be unavailable until you restart the service.',
  ],
  刷新: ['Aktualisieren', 'تحديث', 'Refresh'],
  取消: ['Abbrechen', 'إلغاء', 'Cancel'],
  确认停止: ['Stopp bestätigen', 'تأكيد الإيقاف', 'Confirm stop'],
  停止服务: ['Dienst stoppen', 'إيقاف الخدمة', 'Stop service'],
} as const satisfies Messages
