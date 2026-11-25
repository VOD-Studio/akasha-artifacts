import type { Messages } from '@/shared/i18n'

export const recoveryMessages = {
  '出错源码片段：': ['Quelltextausschnitt:', 'مقطع الشيفرة المتسبب في الخطأ:', 'Source excerpt:'],
  '调用栈：': ['Aufrufliste:', 'مكدس الاستدعاءات:', 'Call stack:'],
  发送失败: ['Senden fehlgeschlagen', 'تعذّر الإرسال', 'Could not send'],
  无法加载预览: [
    'Vorschau konnte nicht geladen werden',
    'تعذّر تحميل المعاينة',
    'Could not load preview',
  ],
  预览出错: ['Vorschaufehler', 'خطأ في المعاينة', 'Preview error'],
  '源码 {loc}': ['Quelltext {loc}', 'الشيفرة المصدرية {loc}', 'Source {loc}'],
  '已交给 Agent 修复': [
    'An den Agenten übermittelt',
    'أُرسل إلى الوكيل لإصلاحه',
    'Sent to agent for repair',
  ],
  '交给 Agent 修复': ['Vom Agenten beheben lassen', 'إرسال إلى الوكيل لإصلاحه', 'Ask agent to fix'],
  关闭错误面板: ['Fehleranzeige schließen', 'إغلاق لوحة الخطأ', 'Close error panel'],
  收起详情: ['Details ausblenden', 'إخفاء التفاصيل', 'Hide details'],
  查看详情: ['Details anzeigen', 'عرض التفاصيل', 'Show details'],
} as const satisfies Messages
