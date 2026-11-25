import type { Messages } from '@/shared/i18n'

export const messages = {
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
