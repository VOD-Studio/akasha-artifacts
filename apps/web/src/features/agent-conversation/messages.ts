import type { Messages } from '@/shared/i18n'

export const messages = {
  '固定 {version}': [
    'Festgelegte Version {version}',
    'الإصدار المثبّت {version}',
    'Pinned {version}',
  ],
  '画板 {id}': ['Zeichenfläche {id}', 'لوحة الرسم {id}', 'Artboard {id}'],
  '对象 {id}': ['Objekt {id}', 'العنصر {id}', 'Object {id}'],
  'Agent 会话记录': [
    'Gesprächsverlauf mit dem Agenten',
    'سجل المحادثة مع الوكيل',
    'Agent conversation history',
  ],
  你: ['Du', 'أنت', 'You'],
  已发送的参考材料: ['Gesendete Referenzen', 'المراجع المرسلة', 'Sent references'],
  'Codex 回复': ['Antwort von Codex', 'رد Codex', 'Codex reply'],
  此轮发布的版本: [
    'In dieser Runde veröffentlichte Versionen',
    'الإصدارات المنشورة في هذه الجولة',
    'Versions published in this turn',
  ],
  '已发布 {version}': ['{version} veröffentlicht', 'نُشر {version}', 'Published {version}'],
  已更新的画板: ['Geänderte Zeichenflächen', 'لوحات الرسم المحدَّثة', 'Updated artboards'],
  '处理中…': ['Wird verarbeitet…', 'جارٍ التنفيذ…', 'Processing…'],
  处理失败: ['Verarbeitung fehlgeschlagen', 'تعذّر التنفيذ', 'Processing failed'],
  未发布新版本: [
    'Keine neue Version veröffentlicht',
    'لم يُنشر إصدار جديد',
    'No new version published',
  ],
  登录本机作品库: [
    'Bei der lokalen Bibliothek anmelden',
    'سجّل الدخول إلى المكتبة المحلية',
    'Sign in to the local library',
  ],
  无法读取会话: [
    'Gespräch konnte nicht geladen werden',
    'تعذّر تحميل المحادثة',
    'Could not load conversation',
  ],
  未绑定会话: ['Kein Gespräch verknüpft', 'لا توجد محادثة مرتبطة', 'No linked conversation'],
  '在项目目录连接 Codex': [
    'Codex im Projektverzeichnis verbinden',
    'اتصل بـ Codex من مجلد المشروع',
    'Connect Codex from the project directory',
  ],
  'Codex 正忙': ['Codex ist beschäftigt', 'Codex مشغول', 'Codex is busy'],
  '正在连接…': ['Verbindung wird hergestellt…', 'جارٍ الاتصال…', 'Connecting…'],
  'Agent 对话': ['Agentengespräch', 'محادثة الوكيل', 'Agent conversation'],
  返回画布: ['Zurück zur Arbeitsfläche', 'العودة إلى مساحة العمل', 'Back to canvas'],
  移除选区引用: ['Auswahlverweis entfernen', 'إزالة مرجع التحديد', 'Remove selection reference'],
  消息: ['Nachricht', 'الرسالة', 'Message'],
  '未发送：{error}': ['Nicht gesendet: {error}', 'لم تُرسل الرسالة: {error}', 'Not sent: {error}'],
  发送: ['Senden', 'إرسال', 'Send'],
} as const satisfies Messages
