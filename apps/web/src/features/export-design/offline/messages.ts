import type { Messages } from '@/shared/i18n'

export const messages = {
  无法打开离线预览: [
    'Offline-Vorschau nicht verfügbar',
    'تعذّر فتح المعاينة دون اتصال',
    'Cannot open offline preview',
  ],
  有图片无法离线加载: [
    'Ein Bild konnte offline nicht geladen werden',
    'تعذّر تحميل إحدى الصور دون اتصال',
    'An image could not be loaded offline',
  ],
  离线画板数据缺失: [
    'Daten der Offline-Zeichenfläche fehlen',
    'بيانات لوحة الرسم غير متوفرة',
    'Offline artboard data is missing',
  ],
  此作品无法离线打开: [
    'Dieses Werk lässt sich offline nicht öffnen',
    'لا يمكن فتح هذا العمل دون اتصال',
    'This artifact cannot be opened offline',
  ],
  '不能离线载入资源：{location}': [
    'Ressource offline nicht verfügbar: {location}',
    'لا يمكن تحميل المورد دون اتصال: {location}',
    'Cannot load resource offline: {location}',
  ],
  离线运行器启动失败: [
    'Offline-Laufzeit konnte nicht starten',
    'تعذّر بدء مشغّل المعاينة دون اتصال',
    'The offline runtime could not start',
  ],
  浏览器无法解压离线运行器: [
    'Der Browser kann die Offline-Laufzeit nicht entpacken',
    'لا يستطيع المتصفح فك ضغط مشغّل المعاينة',
    'This browser cannot unpack the offline runtime',
  ],
  指定版本没有可导出的画板: [
    'Diese Version enthält keine exportierbaren Zeichenflächen',
    'لا توجد لوحات قابلة للتصدير في هذا الإصدار',
    'The specified version has no artboards to export',
  ],
  '单板 ZIP 只能包含一张画板': [
    'Ein Einzel-ZIP kann nur eine Zeichenfläche enthalten',
    'يمكن أن تتضمن حزمة اللوحة الواحدة لوحة واحدة فقط',
    'A single-artboard ZIP must contain exactly one artboard',
  ],
  '离线包不能加载 CSS @import，请内联样式和资源': [
    'Offline-Pakete unterstützen kein CSS @import. Stile und Ressourcen direkt einbetten',
    'لا تدعم حزم العمل دون اتصال CSS @import. ضمّن الأنماط والموارد مباشرةً',
    'Offline packages do not support CSS @import. Inline styles and resources instead',
  ],
  '不能离线打包样式资源：{url}': [
    'Stilressource nicht offline verfügbar: {url}',
    'لا يمكن حزم مورد النمط دون اتصال: {url}',
    'Cannot package style resource offline: {url}',
  ],
  '不能离线打包资源：{url}': [
    'Ressource nicht offline verfügbar: {url}',
    'لا يمكن حزم المورد دون اتصال: {url}',
    'Cannot package resource offline: {url}',
  ],
  '离线包不接受 srcset，请改用单个内嵌的 data: 图片': [
    'Offline-Pakete unterstützen kein srcset. Ein einzelnes eingebettetes data:-Bild verwenden',
    'لا تدعم الحزمة srcset. استخدم صورة data: مضمّنة واحدة',
    'Offline packages do not support srcset. Use a single embedded data: image instead',
  ],
  'HTML 离线包不支持外部嵌入或脚本；交互请使用表单、声明的流程或 React': [
    'Offline-HTML unterstützt keine externen Einbettungen oder Skripte. Für Interaktionen Formulare, definierte Abläufe oder React verwenden',
    'لا تدعم حزمة HTML دون اتصال التضمينات الخارجية أو البرامج النصية. استخدم النماذج أو التدفقات المعرّفة أو React للتفاعل',
    'Offline HTML does not support external embeds or scripts. Use forms, declared flows, or React for interactions',
  ],
  '不能离线打包 SVG 资源：{url}': [
    'SVG-Ressource nicht offline verfügbar: {url}',
    'لا يمكن حزم مورد SVG دون اتصال: {url}',
    'Cannot package SVG resource offline: {url}',
  ],
  '依赖运行存储的交互不能离线打包，请改用内置初始数据': [
    'Interaktionen mit Laufzeitspeicher sind offline nicht verfügbar. Eingebettete Anfangsdaten verwenden',
    'لا يمكن حزم التفاعلات التي تعتمد على تخزين التشغيل. استخدم بيانات أولية مضمّنة',
    'Interactions that depend on runtime storage cannot be packaged offline. Embed initial data instead',
  ],
  画板无法离线打开: [
    'Zeichenfläche lässt sich offline nicht öffnen',
    'تعذّر فتح اللوحة دون اتصال',
    'Cannot open the artboard offline',
  ],
  '「{title}」：{error}': ['„{title}“: {error}', '«{title}»: {error}', '“{title}”: {error}'],
  无法离线渲染: [
    'Offline-Rendern nicht möglich',
    'تعذّر التصيير دون اتصال',
    'Cannot render offline',
  ],
  '缺少离线运行资产，请检查实例是否完整构建（make build）': [
    'Offline-Laufzeitdateien fehlen. Vollständigen Build prüfen (make build)',
    'ملفات التشغيل دون اتصال مفقودة. تحقّق من اكتمال بناء الخدمة (make build)',
    'Offline runtime assets are missing. Check that the instance was built completely (make build)',
  ],
} as const satisfies Messages
