import type { Messages } from '@/shared/i18n'

export const messages = {
  添加参考文件: ['Referenzdateien hinzufügen', 'إضافة ملفات مرجعية', 'Add reference files'],
  选择参考目录: ['Referenzordner auswählen', 'اختيار مجلد مرجعي', 'Choose reference folder'],
  '仅在本机列出目录中的候选文件，不上传目录。': [
    'Dateien werden nur lokal aufgelistet. Der Ordner wird nicht hochgeladen.',
    'تُعرض أسماء الملفات على جهازك فقط، ولا يُرفع المجلد.',
    'Files are listed only on this device. The folder is not uploaded.',
  ],
  '此目录没有可添加的参考文件。': [
    'Dieser Ordner enthält keine geeigneten Referenzdateien.',
    'لا يحتوي هذا المجلد على ملفات مرجعية يمكن إضافتها.',
    'This folder has no eligible reference files.',
  ],
  '目录候选（尚未加入本轮）': [
    'Dateien im Ordner (noch nicht hinzugefügt)',
    'ملفات المجلد (لم تُضَف إلى هذه الرسالة)',
    'Files in this folder (not added to this turn)',
  ],
  '勾选后点击「添加所选文件」才会读取文件并生成预览。': [
    'Dateien werden erst nach der Auswahl mit „Ausgewählte Dateien hinzufügen“ gelesen und in der Vorschau angezeigt.',
    'حدّد الملفات ثم اضغط على «إضافة الملفات المحددة» لقراءتها ومعاينتها.',
    'Check individual files, then choose “Add selected files” to read and preview them.',
  ],
  添加所选文件: ['Ausgewählte Dateien hinzufügen', 'إضافة الملفات المحددة', 'Add selected files'],
  本轮参考材料: ['Referenzen für diese Nachricht', 'مراجع هذه الرسالة', 'References for this turn'],
  '本轮不发送参考材料。': [
    'Diese Nachricht wird ohne Referenzen gesendet.',
    'ستُرسل هذه الرسالة من دون مراجع.',
    'No references will be sent with this turn.',
  ],
  '本轮将发送以下材料。': [
    'Diese Referenzen werden mit der Nachricht gesendet.',
    'ستُرسل المراجع التالية مع هذه الرسالة.',
    'These references will be sent with this turn.',
  ],
  '所有材料就绪后才能发送；也可以移除未就绪的材料。': [
    'Zum Senden müssen alle Referenzen bereit sein. Nicht bereite Dateien können entfernt werden.',
    'لا يمكن الإرسال قبل أن تجهز جميع المراجع. يمكنك إزالة أي مرجع غير جاهز.',
    'All references must be ready before sending. You can remove any that are not ready.',
  ],
  图片: ['Bild', 'صورة', 'Image'],
  文档: ['Dokument', 'مستند', 'Document'],
  演示文稿: ['Präsentation', 'عرض تقديمي', 'Presentation'],
  设计参考: ['Designreferenz', 'مرجع تصميم', 'Design reference'],
  '{size} 字节': ['{size} Byte', '{size} بايت', '{size} bytes'],
  '正在准备材料…': ['Datei wird vorbereitet…', 'جارٍ تجهيز الملف…', 'Preparing reference…'],
  材料处理失败: ['Datei konnte nicht verarbeitet werden', 'تعذرت معالجة الملف', 'Reference failed'],
  预览已过期: ['Vorschau abgelaufen', 'انتهت صلاحية المعاينة', 'Preview expired'],
  '预览 {name}': ['Vorschau: {name}', 'معاينة {name}', 'Preview {name}'],
  '图片预览：{name}': ['Bildvorschau: {name}', 'معاينة الصورة: {name}', 'Image preview: {name}'],
  重试: ['Erneut versuchen', 'إعادة المحاولة', 'Retry'],
  '重试 {name}': ['{name} erneut versuchen', 'إعادة محاولة {name}', 'Retry {name}'],
  移除: ['Entfernen', 'إزالة', 'Remove'],
  '移除 {name}': ['{name} entfernen', 'إزالة {name}', 'Remove {name}'],
} as const satisfies Messages
