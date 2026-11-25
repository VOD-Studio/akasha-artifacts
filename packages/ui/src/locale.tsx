import { Direction } from 'radix-ui'
import { createContext, type ReactNode, useContext } from 'react'

/** 控件的内建提示语言；作品内容和调用方提供的名称不参与翻译。 */
export type UiLocale = 'zh-CN' | 'en' | 'de' | 'ar'

const text = {
  'zh-CN': {
    close: '关闭',
    confirm: '确认',
    cancel: '取消',
    clearAll: '清除全部',
    noOptions: '无选项',
    loading: '加载中…',
    discardQuestion: '有未保存的修改，要放弃吗？',
    keep: '继续编辑',
    discard: '放弃修改',
    pending: (action: string) => `正在${action}…`,
    typeToConfirm: (name: ReactNode) => <>输入 {name} 继续</>,
    dismissedOutside: (cancel: string) => `点遮罩不会关闭，按 Esc 或点「${cancel}」`,
    remove: (name: string) => `移除 ${name}`,
    selected: (names: string[], count: number) =>
      count > names.length ? `已选 ${names.join('、')} 等 ${count} 项` : `已选 ${names.join('、')}`,
  },
  en: {
    close: 'Close',
    confirm: 'Confirm',
    cancel: 'Cancel',
    clearAll: 'Clear selection',
    noOptions: 'No options',
    loading: 'Loading…',
    discardQuestion: 'Discard unsaved changes?',
    keep: 'Keep editing',
    discard: 'Discard changes',
    pending: () => 'Working…',
    typeToConfirm: (name: ReactNode) => <>Type {name} to continue</>,
    dismissedOutside: (cancel: string) => `Press Esc or choose “${cancel}” to close.`,
    remove: (name: string) => `Remove ${name}`,
    selected: (names: string[], count: number) =>
      count > names.length
        ? `Selected: ${names.join(', ')} (${count.toLocaleString('en')} total)`
        : `Selected: ${names.join(', ')}`,
  },
  de: {
    close: 'Schließen',
    confirm: 'Bestätigen',
    cancel: 'Abbrechen',
    clearAll: 'Auswahl aufheben',
    noOptions: 'Keine Optionen',
    loading: 'Wird geladen…',
    discardQuestion: 'Ungespeicherte Änderungen verwerfen?',
    keep: 'Weiter bearbeiten',
    discard: 'Änderungen verwerfen',
    pending: () => 'Wird ausgeführt…',
    typeToConfirm: (name: ReactNode) => <>Zum Fortfahren {name} eingeben</>,
    dismissedOutside: (cancel: string) => `Zum Schließen Esc drücken oder „${cancel}“ wählen.`,
    remove: (name: string) => `${name} entfernen`,
    selected: (names: string[], count: number) =>
      count > names.length
        ? `Ausgewählt: ${names.join(', ')} (${count.toLocaleString('de')} insgesamt)`
        : `Ausgewählt: ${names.join(', ')}`,
  },
  ar: {
    close: 'إغلاق',
    confirm: 'تأكيد',
    cancel: 'إلغاء',
    clearAll: 'مسح الكل',
    noOptions: 'لا توجد خيارات',
    loading: 'جارٍ التحميل…',
    discardQuestion: 'هل تريد تجاهل التغييرات غير المحفوظة؟',
    keep: 'متابعة التحرير',
    discard: 'تجاهل التغييرات',
    pending: () => 'جارٍ التنفيذ…',
    typeToConfirm: (name: ReactNode) => <>اكتب {name} للمتابعة</>,
    dismissedOutside: (cancel: string) => `للإغلاق اضغط على Esc أو اختر «${cancel}».`,
    remove: (name: string) => `إزالة ${name}`,
    selected: (names: string[], count: number) =>
      count > names.length
        ? `المحدد: ${names.join('، ')} (المجموع: ${count.toLocaleString('ar-u-nu-arab')})`
        : `المحدد: ${names.join('، ')}`,
  },
} as const

const Context = createContext<UiLocale>('zh-CN')

/** 在同一棵 React 树（包括浮层 Portal）中同步内建文案与 Radix 键盘导航方向。 */
export function UiLocaleProvider({ locale, children }: { locale: UiLocale; children: ReactNode }) {
  return (
    <Context.Provider value={locale}>
      <Direction.Provider dir={locale === 'ar' ? 'rtl' : 'ltr'}>{children}</Direction.Provider>
    </Context.Provider>
  )
}

/** 供共享组件读取默认文案；显式传入的标签仍优先。 */
export function useUiLocale() {
  const locale = useContext(Context)
  return { labels: text[locale], dir: locale === 'ar' ? 'rtl' : 'ltr' } as const
}
