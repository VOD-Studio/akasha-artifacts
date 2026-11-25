import type { Messages } from '@/shared/i18n'

export const messages = {
  分享策略: ['Freigabe-Richtlinie', 'سياسة المشاركة', 'Sharing policy'],
  策略不可用: ['Richtlinie nicht verfügbar', 'السياسة غير متاحة', 'Policy unavailable'],
  正在读取登录状态: [
    'Anmeldestatus wird geladen',
    'جارٍ تحميل حالة تسجيل الدخول',
    'Loading sign-in status',
  ],
  无法读取登录状态: [
    'Anmeldestatus konnte nicht gelesen werden',
    'تعذر قراءة حالة تسجيل الدخول',
    'Could not load sign-in status',
  ],
  重试: ['Erneut versuchen', 'إعادة المحاولة', 'Retry'],
  '使用 GitHub 登录': [
    'Mit GitHub anmelden',
    'تسجيل الدخول باستخدام GitHub',
    'Sign in with GitHub',
  ],
  '仅 Hub 管理员可用': [
    'Nur für Hub-Administratoren verfügbar',
    'هذه الصفحة متاحة لمسؤولي Hub فقط',
    'Only Hub administrators can use this page',
  ],
  '当前账号不是 Hub 管理员': [
    'Dieses Konto ist kein Hub-Administrator',
    'هذا الحساب ليس مسؤول Hub',
    'This account is not a Hub administrator',
  ],
  返回作品库: ['Zur Werkbibliothek', 'العودة إلى مكتبة الأعمال', 'Back to library'],
  正在读取策略: ['Richtlinie wird geladen', 'جارٍ تحميل السياسة', 'Loading policy'],
  '无法读取分享策略：{reason}': [
    'Freigabe-Richtlinie konnte nicht gelesen werden: {reason}',
    'تعذر قراءة سياسة المشاركة: {reason}',
    'Could not load the sharing policy: {reason}',
  ],
  '保存失败：{reason}': [
    'Speichern fehlgeschlagen: {reason}',
    'تعذر الحفظ: {reason}',
    'Could not save: {reason}',
  ],
  'Hub 默认值': ['Hub-Standardwerte', 'الإعدادات الافتراضية لـ Hub', 'Hub defaults'],
  '只控制向组织外的授权，组织成员访问不受影响': [
    'Steuert nur Berechtigungen nach außerhalb der Organisation; der Mitgliederzugriff bleibt unberührt.',
    'يتحكم فقط في الأذونات الممنوحة خارج المؤسسة؛ وصول الأعضاء لا يتأثر بذلك.',
    'Only governs grants outside the organization; member access is unaffected.',
  ],
  作品例外: ['Ausnahme für dieses Werk', 'استثناء لهذا العمل', 'Exception for this artifact'],
  例外只作用于这一个作品: [
    'Die Ausnahme gilt nur für dieses eine Werk.',
    'يسري الاستثناء على هذا العمل وحده.',
    'The exception applies to this one artifact only.',
  ],
  外发链接: ['Externe Links', 'الروابط الخارجية', 'External links'],
  外部邮箱: ['Externe E-Mail-Adressen', 'البريد الخارجي', 'External email'],
  允许向组织外分享普通链接: [
    'Erlaubt reguläre Freigabe-Links nach außerhalb der Organisation.',
    'يسمح بمشاركة الروابط العادية خارج المؤسسة.',
    'Allows regular share links to leave the organization.',
  ],
  '关闭时仅接受已验证的 Hub 成员邮箱': [
    'Wenn deaktiviert, werden nur verifizierte Adressen von Hub-Mitgliedern akzeptiert.',
    'عند الإيقاف تُقبل عناوين أعضاء Hub الموثقة فقط.',
    'When off, only verified Hub member addresses are accepted.',
  ],
  允许: ['Erlauben', 'السماح', 'Allow'],
  禁止: ['Sperren', 'المنع', 'Deny'],
  继承默认: ['Standard übernehmen', 'اتباع الافتراضي', 'Follow default'],
  '当前默认：{value}': [
    'Aktueller Standard: {value}',
    'القيمة الافتراضية الحالية: {value}',
    'Current default: {value}',
  ],
  打开作品分享策略: [
    'Freigabe-Richtlinie eines Werks öffnen',
    'فتح سياسة مشاركة عمل',
    'Open an artifact’s sharing policy',
  ],
  '按作品 ID 打开，不需要作品读取权限': [
    'Über die Werk-ID öffnen; eine Leseberechtigung für das Werk ist nicht erforderlich.',
    'الفتح عبر معرّف العمل؛ لا حاجة لصلاحية قراءة العمل.',
    'Open by artifact ID; no artifact read permission is required.',
  ],
  '作品 ID': ['Werk-ID', 'معرّف العمل', 'Artifact ID'],
  '作品页地址 /a/<作品 ID> 中的 ID': [
    'Die ID aus der Werkadresse /a/<Werk-ID>',
    'المعرّف الوارد في عنوان صفحة العمل /a/<معرّف العمل>',
    'The ID in the artifact address /a/<artifact ID>',
  ],
  打开: ['Öffnen', 'فتح', 'Open'],
  取消: ['Abbrechen', 'إلغاء', 'Cancel'],
} as const satisfies Messages
