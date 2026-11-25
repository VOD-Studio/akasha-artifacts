import { ARTBOARD_GEOMETRY_LIMITS } from '@akasha/protocol'
import { type Messages, useMessages } from '@/shared/i18n'

const editErrors = {
  '作品已更新，未覆盖新版本。': [
    'Das Werk wurde aktualisiert. Die neue Version wurde nicht überschrieben.',
    'حُدّث العمل. لم يُستبدل الإصدار الجديد.',
    'The artifact was updated. The new version was not overwritten.',
  ],
  无法保存改动: [
    'Änderungen konnten nicht gespeichert werden',
    'تعذّر حفظ التغييرات',
    'Could not save changes',
  ],
  无法应用改动: [
    'Änderungen konnten nicht angewendet werden',
    'تعذّر تطبيق التغييرات',
    'Could not apply changes',
  ],
  '画板宽高须在 1–{limit} CSS 像素之间': [
    'Breite und Höhe müssen zwischen 1 und {limit} CSS-Pixeln liegen',
    'يجب أن يكون عرض اللوحة وارتفاعها بين ١ و{limit} بكسل CSS',
    'Artboard width and height must be between 1 and {limit} CSS pixels',
  ],
  画板位置超出画布坐标范围: [
    'Die Zeichenfläche liegt außerhalb des zulässigen Koordinatenbereichs',
    'موضع اللوحة خارج نطاق الإحداثيات المسموح به',
    'The artboard position is outside the canvas coordinate range',
  ],
  画板标识已存在: [
    'Die Zeichenflächen-ID ist bereits vergeben',
    'معرّف لوحة الرسم مستخدم بالفعل',
    'This artboard ID is already in use',
  ],
  要复制的画板已不存在: [
    'Die zu duplizierende Zeichenfläche existiert nicht mehr',
    'لم تعد لوحة الرسم المراد تكرارها موجودة',
    'The artboard to duplicate no longer exists',
  ],
  要删除的画板已不存在: [
    'Die zu löschende Zeichenfläche existiert nicht mehr',
    'لم تعد لوحة الرسم المراد حذفها موجودة',
    'The artboard to delete no longer exists',
  ],
  该分组包含已移除的画板: [
    'Die Gruppe enthält entfernte Zeichenflächen',
    'تحتوي المجموعة على لوحات أُزيلت',
    'This group contains artboards that have been removed',
  ],
  要调整的画板已不存在: [
    'Die zu ändernde Zeichenfläche existiert nicht mehr',
    'لم تعد لوحة الرسم المراد تعديلها موجودة',
    'The artboard to adjust no longer exists',
  ],
  画板背景或圆角不符合约束: [
    'Hintergrund oder Eckenradius der Zeichenfläche ist ungültig',
    'خلفية لوحة الرسم أو نصف قطر زواياها غير صالح',
    'Invalid artboard background or corner radius',
  ],
  原生图层所在的画板已变更: [
    'Die Zeichenfläche dieser Ebene hat sich geändert',
    'تغيّرت لوحة الرسم التي تحتوي على هذه الطبقة',
    'The artboard that contains this layer has changed',
  ],
  图层已不存在: [
    'Die Ebene existiert nicht mehr',
    'لم تعد الطبقة موجودة',
    'The layer no longer exists',
  ],
  该图层没有可编辑的文字: [
    'Diese Ebene enthält keinen bearbeitbaren Text',
    'لا يوجد نص قابل للتحرير في هذه الطبقة',
    'This layer has no editable text',
  ],
  '画板最多可容纳 96 个图层，标识必须唯一': [
    'Eine Zeichenfläche kann höchstens 96 Ebenen mit eindeutigen IDs enthalten',
    'يمكن أن تحتوي لوحة الرسم على ٩٦ طبقة كحد أقصى، ويجب أن تكون المعرّفات فريدة',
    'An artboard can contain up to 96 layers, each with a unique ID',
  ],
  要调整的图层已不存在: [
    'Die zu ändernde Ebene existiert nicht mehr',
    'لم تعد الطبقة المراد تعديلها موجودة',
    'The layer to adjust no longer exists',
  ],
  该分组中的图层已不存在: [
    'Eine Ebene dieser Gruppe existiert nicht mehr',
    'لم تعد إحدى طبقات هذه المجموعة موجودة',
    'A layer in this group no longer exists',
  ],
  图层变更不符合画板的设计数据约束: [
    'Die Ebenenänderung entspricht nicht den Datenvorgaben der Zeichenfläche',
    'لا يتوافق تعديل الطبقة مع قيود بيانات لوحة الرسم',
    'The layer changes do not meet the artboard’s design constraints',
  ],
  '当前源码有重复的页面或画板标识，请修正后再编辑': [
    'Der Quelltext enthält doppelte Seiten- oder Zeichenflächen-IDs. Korrigiere sie vor der Bearbeitung.',
    'تتضمن الشيفرة معرّفات صفحات أو لوحات مكررة. صحّحها قبل التحرير.',
    'The source contains duplicate page or artboard IDs. Correct them before editing.',
  ],
  '作品已更新，请重新操作': [
    'Das Werk wurde aktualisiert. Wiederhole den Vorgang.',
    'حُدّث العمل. أعد المحاولة.',
    'The artifact has been updated. Try again.',
  ],
  无法保存页面: [
    'Seite konnte nicht gespeichert werden',
    'تعذّر حفظ الصفحة',
    'Could not save the page',
  ],
  页面标识已存在: [
    'Die Seiten-ID ist bereits vergeben',
    'معرّف الصفحة مستخدم بالفعل',
    'This page ID is already in use',
  ],
  该页面已不存在: [
    'Diese Seite existiert nicht mehr',
    'لم تعد هذه الصفحة موجودة',
    'This page no longer exists',
  ],
} as const satisfies Messages

function isEditError(message: string): message is keyof typeof editErrors {
  return Object.hasOwn(editErrors, message)
}

/** 已知编辑诊断随界面语言更新，来自服务端的具体原因原样保留。 */
export function useBoardEditError(message: string) {
  const { t } = useMessages(editErrors)
  const limit = ARTBOARD_GEOMETRY_LIMITS.viewport
  if (message === `画板宽高须在 1–${limit} CSS 像素之间`) {
    return t('画板宽高须在 1–{limit} CSS 像素之间', { limit })
  }
  return isEditError(message) ? t(message) : message
}
