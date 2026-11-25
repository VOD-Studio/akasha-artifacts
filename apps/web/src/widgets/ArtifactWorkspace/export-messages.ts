import type { Messages } from '@/shared/i18n'

export const messages = {
  画板渲染超时: [
    'Zeitüberschreitung beim Rendern der Zeichenfläche',
    'انتهت مهلة تصيير اللوحة',
    'Artboard rendering timed out',
  ],
  无法生成画面: [
    'Bild konnte nicht gerendert werden',
    'تعذّر تصيير الصورة',
    'Could not render an image',
  ],
  '正在渲染 {current}/{total}：{title}': [
    'Rendern {current}/{total}: {title}',
    'جارٍ التصيير {current}/{total}: {title}',
    'Rendering {current}/{total}: {title}',
  ],
  '「{title}」：{error}': ['„{title}“: {error}', '«{title}»: {error}', '“{title}”: {error}'],
  未能读取指定版本: [
    'Die angegebene Version konnte nicht geladen werden',
    'تعذّرت قراءة الإصدار المحدد',
    'Could not load the specified version',
  ],
  '正在检查版本访问权限…': [
    'Versionszugriff wird geprüft…',
    'جارٍ التحقق من صلاحية الوصول إلى الإصدار…',
    'Checking version access…',
  ],
  指定版本没有这张画板: [
    'Diese Zeichenfläche fehlt in der angegebenen Version',
    'لا يحتوي الإصدار المحدد على هذه اللوحة',
    'This artboard is not in the specified version',
  ],
  未选择画板: ['Keine Zeichenfläche ausgewählt', 'لم تُحدّد أي لوحة', 'No artboards selected'],
  指定版本没有可导出的画板: [
    'Diese Version enthält keine exportierbaren Zeichenflächen',
    'لا توجد لوحات قابلة للتصدير في هذا الإصدار',
    'The specified version has no artboards to export',
  ],
  '请选择一张画板导出 PNG': [
    'Für PNG eine Zeichenfläche auswählen',
    'اختر لوحة واحدة لتصدير PNG',
    'Select one artboard to export as PNG',
  ],
  没有成功渲染的画面: [
    'Kein Bild wurde erfolgreich gerendert',
    'لم ينجح تصيير أي صورة',
    'No images rendered successfully',
  ],
  导出失败: ['Export fehlgeschlagen', 'فشل التصدير', 'Export failed'],
  导出画板: ['Zeichenfläche exportieren', 'تصدير اللوحة', 'Export artboard'],
  导出作品: ['Werk exportieren', 'تصدير العمل', 'Export artifact'],
  '{snapshot}。仅导出已保存的画板，不含批注和工作区工具。': [
    '{snapshot}. Nur gespeicherte Zeichenflächen werden exportiert, ohne Kommentare oder Arbeitsbereichswerkzeuge.',
    '{snapshot}. تُصدّر اللوحات المحفوظة فقط، دون التعليقات أو أدوات مساحة العمل.',
    '{snapshot}. Only saved artboards are exported. Comments and workspace tools are excluded.',
  ],
  取消: ['Abbrechen', 'إلغاء', 'Cancel'],
  导出: ['Exportieren', 'تصدير', 'Export'],
  导出范围: ['Exportumfang', 'نطاق التصدير', 'Export scope'],
  '选区 PDF 页序': [
    'PDF-Seitenreihenfolge der Auswahl',
    'ترتيب صفحات PDF للتحديد',
    'PDF page order for selection',
  ],
  格式: ['Format', 'الصيغة', 'Format'],
  '离线 HTML': ['Offline-HTML', 'HTML دون اتصال', 'Offline HTML'],
  'PNG 倍率': ['PNG-Skalierung', 'مقياس PNG', 'PNG scale'],
  输出像素尺寸: ['Ausgabegröße in Pixeln', 'أبعاد الصورة بالبكسل', 'Output dimensions in pixels'],
  '{width} × {height} 像素': [
    '{width} × {height} Pixel',
    '{width} × {height} بكسل',
    '{width} × {height} pixels',
  ],
  '当前版本没有可导出的画板。': [
    'Diese Version enthält keine exportierbaren Zeichenflächen.',
    'لا توجد لوحات قابلة للتصدير في الإصدار الحالي.',
    'This version has no artboards to export.',
  ],
  '无法读取导出版本：{error}': [
    'Exportversion konnte nicht geladen werden: {error}',
    'تعذّرت قراءة إصدار التصدير: {error}',
    'Could not read the version to export: {error}',
  ],
  重试: ['Erneut versuchen', 'إعادة المحاولة', 'Retry'],
  '正在读取导出版本…': [
    'Exportversion wird geladen…',
    'جارٍ تحميل إصدار التصدير…',
    'Loading version to export…',
  ],
  '解压后打开 index.html，离线预览所选画板。': [
    'Archiv entpacken und index.html öffnen, um die gewählte Zeichenfläche offline anzusehen.',
    'فك الضغط وافتح index.html لمعاينة اللوحة المحددة دون اتصال.',
    'Extract the archive and open index.html to preview the selected artboard offline.',
  ],
  '打开 HTML 即可离线预览，支持已定义的跨画板跳转。': [
    'HTML-Datei für die Offline-Vorschau öffnen. Definierte Übergänge zwischen Zeichenflächen bleiben erhalten.',
    'افتح ملف HTML للمعاينة دون اتصال مع التنقل المحدد بين اللوحات.',
    'Open the HTML file for an offline preview with the defined transitions between artboards.',
  ],
  '不包含运行存储；依赖外部资源的画板无法离线打包。': [
    'Laufzeitdaten sind nicht enthalten. Zeichenflächen mit externen Ressourcen lassen sich nicht offline verpacken.',
    'لا تشمل الحزمة بيانات التشغيل. لا يمكن حزم اللوحات التي تعتمد على موارد خارجية للاستخدام دون اتصال.',
    'Runtime storage is excluded. Artboards that depend on external resources cannot be packaged for offline use.',
  ],
  '{error}。未下载文件。': [
    '{error}. Es wurde keine Datei heruntergeladen.',
    '{error}. لم يُنزّل أي ملف.',
    '{error}. No file was downloaded.',
  ],
  所选画板不属于此作品的固定版本: [
    'Die Auswahl gehört nicht zur festen Version dieses Werks',
    'اللوحات المحددة لا تنتمي إلى الإصدار الثابت من هذا العمل',
    'The selection does not belong to this pinned version of the artifact',
  ],
  固定版本中没有选区所在的页面: [
    'Die Seite der Auswahl fehlt in der festen Version',
    'صفحة التحديد غير موجودة في الإصدار الثابت',
    'The selected page is not in the pinned version',
  ],
  当前页面不包含全部所选画板: [
    'Die aktuelle Seite enthält nicht alle ausgewählten Zeichenflächen',
    'الصفحة الحالية لا تحتوي على كل اللوحات المحددة',
    'The current page does not contain all selected artboards',
  ],
  无法确定所选画板在页面中的位置: [
    'Position einer ausgewählten Zeichenfläche nicht ermittelbar',
    'تعذّر تحديد موضع اللوحة المحددة في الصفحة',
    'Could not determine the position of a selected artboard',
  ],
  '正在预检 {current}/{total}：{title}': [
    'Vorabprüfung {current}/{total}: {title}',
    'جارٍ التحقق المسبق {current}/{total}: {title}',
    'Checking {current}/{total}: {title}',
  ],
  选区: ['Auswahl', 'التحديد', 'Selection'],
  设计: ['Design', 'تصميم', 'Design'],
  '整份作品（{count} 张）': [
    {
      one: 'Gesamtes Werk ({count} Zeichenfläche)',
      other: 'Gesamtes Werk ({count} Zeichenflächen)',
    },
    {
      zero: 'العمل كاملًا (لا لوحات)',
      one: 'العمل كاملًا (لوحة واحدة)',
      two: 'العمل كاملًا (لوحتان)',
      few: 'العمل كاملًا ({count} لوحات)',
      many: 'العمل كاملًا ({count} لوحة)',
      other: 'العمل كاملًا ({count} لوحة)',
    },
    { one: 'Entire artifact ({count} artboard)', other: 'Entire artifact ({count} artboards)' },
  ],
  '选中画板（{count} 张）': [
    { one: 'Auswahl ({count} Zeichenfläche)', other: 'Auswahl ({count} Zeichenflächen)' },
    {
      zero: 'التحديد (لا لوحات)',
      one: 'التحديد (لوحة واحدة)',
      two: 'التحديد (لوحتان)',
      few: 'التحديد ({count} لوحات)',
      many: 'التحديد ({count} لوحة)',
      other: 'التحديد ({count} لوحة)',
    },
    { one: 'Selection ({count} artboard)', other: 'Selection ({count} artboards)' },
  ],
} as const satisfies Messages
