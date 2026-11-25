import type { Messages } from '@/shared/i18n'

export const messages = {
  设计协作邀请: ['Einladung zur Zusammenarbeit', 'دعوة للتعاون في التصميم', 'Design invitation'],
  '以 @{login} 接受邀请': [
    'Als @{login} annehmen',
    'قبول الدعوة بحساب ‎@{login}',
    'Accept as @{login}',
  ],
  邀请不可用: ['Einladung nicht verfügbar', 'الدعوة غير متاحة', 'Invitation unavailable'],
  重试: ['Erneut versuchen', 'إعادة المحاولة', 'Retry'],
  正在读取登录状态: [
    'Anmeldestatus wird geladen',
    'جارٍ تحميل حالة تسجيل الدخول',
    'Loading sign-in status',
  ],
  '退出 @{login}': ['@{login} abmelden', 'تسجيل الخروج من ‎@{login}', 'Sign out @{login}'],
  '使用 GitHub 登录': [
    'Mit GitHub anmelden',
    'تسجيل الدخول باستخدام GitHub',
    'Sign in with GitHub',
  ],
  无法读取登录状态: [
    'Anmeldestatus konnte nicht gelesen werden',
    'تعذر قراءة حالة تسجيل الدخول',
    'Could not load sign-in status',
  ],
  退出失败: ['Abmeldung fehlgeschlagen', 'تعذر تسجيل الخروج', 'Could not sign out'],
} as const satisfies Messages
