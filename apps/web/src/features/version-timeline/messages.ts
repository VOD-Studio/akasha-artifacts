import type { Messages } from '@/shared/i18n'

export const messages = {
  '已将 {from} 恢复为 {to}': [
    '{from} wurde als {to} wiederhergestellt',
    'استُعيد {from} كإصدار {to}',
    'Restored {from} as {to}',
  ],
  恢复版本失败: [
    'Version konnte nicht wiederhergestellt werden',
    'تعذّرت استعادة الإصدار',
    'Could not restore version',
  ],
  '版本历史，当前 {version}': [
    'Versionsverlauf, aktuell {version}',
    'سجل الإصدارات، الإصدار الحالي {version}',
    'Version history, current {version}',
  ],
  '历史版本 {version}': [
    'Frühere Version {version}',
    'الإصدار السابق {version}',
    'Past version {version}',
  ],
  版本历史: ['Versionsverlauf', 'سجل الإصدارات', 'Version history'],
  最新: ['Neueste', 'الأحدث', 'Latest'],
  当前: ['Ausgewählt', 'الحالي', 'Current'],
  查看最新版本: ['Neueste Version anzeigen', 'عرض أحدث إصدار', 'View latest version'],
  '将 {version} 恢复为新版本': [
    '{version} als neue Version wiederherstellen',
    'استعادة {version} كإصدار جديد',
    'Restore {version} as a new version',
  ],
} as const satisfies Messages
