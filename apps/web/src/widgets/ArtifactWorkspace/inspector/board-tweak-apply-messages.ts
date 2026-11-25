import type { Messages } from '@/shared/i18n'

/** 参数只在收到版本回执后才使用发布完成文案。 */
export const tweakApplyMessages = {
  '应用参数…': ['Parameter anwenden…', 'تطبيق المعلمات…', 'Apply tweaks…'],
  '已发布 v{version}：{boards}': [
    'v{version} veröffentlicht: {boards}',
    'نُشر الإصدار v{version}: ‏{boards}',
    'Published v{version}: {boards}',
  ],
  '仅在此预览。发布新版本后，所选画板才会使用这些值。': [
    'Nur in dieser Vorschau. Die ausgewählten Zeichenflächen übernehmen diese Werte erst mit einer neuen Version.',
    'للمعاينة هنا فقط. لن تستخدم اللوحات المحددة هذه القيم إلا بعد نشر إصدار جديد.',
    'Preview only. Selected artboards will use these values after a new version is published.',
  ],
  '已基于 v{version} 打开，作品已更新。请重新选择。': [
    'Auf Basis von v{version} geöffnet. Das Werk wurde aktualisiert. Bitte erneut auswählen.',
    'فُتح الحوار استنادًا إلى v{version} ثم حُدّث العمل. أعد التحديد.',
    'Opened from v{version}. The artifact has changed. Select the artboards again.',
  ],
  应用参数: ['Parameter anwenden', 'تطبيق المعلمات', 'Apply tweaks'],
  '基准版本 v{version}': [
    'Basisversion v{version}',
    'الإصدار الأساسي v{version}',
    'Base version v{version}',
  ],
  选择画板: ['Zeichenflächen auswählen', 'اختيار اللوحات', 'Select artboards'],
  不兼容: ['Nicht kompatibel', 'غير متوافقة', 'Incompatible'],
  无变化: ['Unverändert', 'لا تغيير', 'Unchanged'],
  正在读取画板: ['Zeichenflächen werden geladen', 'جارٍ تحميل اللوحات', 'Loading artboards'],
  无法读取画板: [
    'Zeichenflächen konnten nicht geladen werden',
    'تعذّر تحميل اللوحات',
    'Could not load artboards',
  ],
  无法应用参数: [
    'Parameter konnten nicht angewendet werden',
    'تعذّر تطبيق المعلمات',
    'Could not apply tweaks',
  ],
  当前没有可用的已绑定会话: [
    'Keine gebundene Sitzung verfügbar',
    'لا تتوفر جلسة مرتبطة',
    'No bound session is available',
  ],
  '请将 v{version} 的预览参数应用到所选画板，并发布一个新版本。': [
    'Wende die Vorschauparameter aus v{version} auf die ausgewählten Zeichenflächen an und veröffentliche eine neue Version.',
    'طبّق معلمات المعاينة من v{version} على اللوحات المحددة وانشر إصدارًا جديدًا.',
    'Apply the preview tweaks from v{version} to the selected artboards and publish a new version.',
  ],
  发布新版本: ['Neue Version veröffentlichen', 'نشر إصدار جديد', 'Publish new version'],
  '请 Agent 应用': [
    'Agent mit Anwendung beauftragen',
    'طلب التطبيق من الوكيل',
    'Ask Agent to apply',
  ],
  取消: ['Abbrechen', 'إلغاء', 'Cancel'],
} as const satisfies Messages
