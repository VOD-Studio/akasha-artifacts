import type { Messages } from '@/shared/i18n'

export const messages = {
  有更新的版本: [
    'Eine neuere Version ist verfügbar',
    'يتوفر إصدار أحدث',
    'A newer version is available',
  ],
  '草稿基于 {base}，最新 {head}': [
    'Entwurf basiert auf {base}, aktuell ist {head}',
    'تستند المسودة إلى {base}، والأحدث {head}',
    'Draft based on {base}; latest: {head}',
  ],
  '其他协作者或 Agent': [
    'Andere Mitwirkende oder Agent',
    'متعاون آخر أو وكيل',
    'Another collaborator or agent',
  ],
  '更新者：{authors}': ['Geändert von: {authors}', 'حدّثه: {authors}', 'Updated by: {authors}'],
  放弃草稿并打开最新: [
    'Entwurf verwerfen und aktuelle Version öffnen',
    'تجاهل المسودة وافتح أحدث إصدار',
    'Discard draft and open latest',
  ],
  将草稿保存为新版本: [
    'Entwurf als neue Version speichern',
    'حفظ المسودة كإصدار جديد',
    'Save draft as a new version',
  ],
  稍后处理: ['Später bearbeiten', 'المعالجة لاحقًا', 'Resolve later'],
  '保存草稿不会合并最新版本的改动。': [
    'Beim Speichern werden die Änderungen der aktuellen Version nicht zusammengeführt.',
    'لن يؤدي حفظ المسودة إلى دمج تغييرات أحدث إصدار.',
    'Saving the draft will not merge changes from the latest version.',
  ],
  '− 最新 {version} / + 你的草稿': [
    '− Aktuelle Version {version} / + Dein Entwurf',
    '− أحدث إصدار {version} / + مسودتك',
    '− Latest {version} / + Your draft',
  ],
  '已保存为 {version}，还有未保存的改动': [
    'Als {version} gespeichert. Weitere Änderungen sind noch nicht gespeichert.',
    'حُفظت المسودة كإصدار {version}، وما زالت هناك تغييرات غير محفوظة',
    'Saved as {version}; you still have unsaved changes',
  ],
  '已保存为 {version}': [
    'Als {version} gespeichert',
    'حُفظت المسودة كإصدار {version}',
    'Saved as {version}',
  ],
  保存失败: ['Speichern fehlgeschlagen', 'تعذّر الحفظ', 'Could not save'],
  无法打开最新版本: [
    'Aktuelle Version konnte nicht geöffnet werden',
    'تعذّر فتح أحدث إصدار',
    'Could not open the latest version',
  ],
  '已打开最新版本 {version}': [
    'Aktuelle Version {version} geöffnet',
    'فُتح أحدث إصدار {version}',
    'Opened latest version {version}',
  ],
  代码编辑: ['Code bearbeiten', 'تحرير الشفرة', 'Edit code'],
  未保存: ['Ungespeichert', 'غير محفوظ', 'Unsaved'],
  放弃草稿: ['Entwurf verwerfen', 'تجاهل المسودة', 'Discard draft'],
  保存为新版本: ['Als neue Version speichern', 'حفظ كإصدار جديد', 'Save as a new version'],
  保存: ['Speichern', 'حفظ', 'Save'],
  代码编辑区: ['Code-Editor', 'محرر الشفرة', 'Code editor'],
} as const satisfies Messages
