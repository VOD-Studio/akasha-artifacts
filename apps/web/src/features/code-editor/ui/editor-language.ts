import { Compartment, EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import type { Locale } from '@/shared/i18n'

const language = new Compartment()
const phrases = {
  Find: ['查找', 'Suchen', 'بحث'],
  Replace: ['替换', 'Ersetzen', 'استبدال'],
  next: ['下一个', 'Weiter', 'التالي'],
  previous: ['上一个', 'Zurück', 'السابق'],
  all: ['全部', 'Alle', 'الكل'],
  'match case': ['区分大小写', 'Groß-/Kleinschreibung', 'مطابقة حالة الأحرف'],
  regexp: ['正则表达式', 'Regulärer Ausdruck', 'تعبير نمطي'],
  'by word': ['全词匹配', 'Ganze Wörter', 'كلمات كاملة'],
  replace: ['替换', 'Ersetzen', 'استبدال'],
  'replace all': ['全部替换', 'Alle ersetzen', 'استبدال الكل'],
  close: ['关闭', 'Schließen', 'إغلاق'],
  'Go to line': ['跳转到行', 'Gehe zu Zeile', 'انتقل إلى السطر'],
  go: ['跳转', 'Springen', 'انتقال'],
  'current match': ['当前匹配', 'Aktueller Treffer', 'المطابقة الحالية'],
  'on line': ['所在行', 'in Zeile', 'في السطر'],
  'replaced match on line $': [
    '已替换第 $ 行的匹配',
    'Treffer in Zeile $ ersetzt',
    'استُبدلت المطابقة في السطر $',
  ],
  'replaced $ matches': ['已替换 $ 处匹配', '$ Treffer ersetzt', 'عدد المطابقات المستبدلة: $'],
  Completions: ['补全建议', 'Vervollständigungen', 'اقتراحات الإكمال'],
  'Control character': ['控制字符', 'Steuerzeichen', 'محرف تحكم'],
  Diagnostics: ['诊断', 'Diagnosen', 'التشخيصات'],
  'No diagnostics': ['无诊断信息', 'Keine Diagnosen', 'لا توجد تشخيصات'],
  'Selection deleted': ['已删除选区', 'Auswahl gelöscht', 'حُذف التحديد'],
  'Folded lines': ['已折叠行', 'Eingeklappte Zeilen', 'الأسطر المطوية'],
  'Unfolded lines': ['已展开行', 'Ausgeklappte Zeilen', 'الأسطر الموسّعة'],
  to: ['至', 'bis', 'إلى'],
  'folded code': ['已折叠代码', 'Eingeklappter Code', 'شفرة مطوية'],
  unfold: ['展开', 'Ausklappen', 'توسيع'],
  'Fold line': ['折叠行', 'Zeile einklappen', 'طي السطر'],
  'Unfold line': ['展开行', 'Zeile ausklappen', 'توسيع السطر'],
} as const

function extensions(locale: Locale, label: string) {
  const attrs = EditorView.contentAttributes.of({ 'aria-label': label, dir: 'ltr' })
  if (locale === 'en') return attrs
  const index = ({ 'zh-CN': 0, de: 1, ar: 2 } as const)[locale]
  const translated = Object.fromEntries(
    Object.entries(phrases).map(([key, values]) => [key, values[index]]),
  )
  return [EditorState.phrases.of(translated), attrs]
}

export function editorLanguage(locale: Locale, label: string) {
  return language.of(extensions(locale, label))
}

/** CodeMirror 更新词表会重绘自己的搜索栏；恢复栏内的焦点与文字选区，不重建编辑状态。 */
export function updateEditorLanguage(view: EditorView, locale: Locale, label: string) {
  const active = view.dom.ownerDocument.activeElement
  const panel = active?.closest('.cm-panel')
  const focusables = 'input, button, select, textarea, [tabindex]'
  const index =
    active && panel && view.dom.contains(panel)
      ? Array.from(view.dom.querySelectorAll(`.cm-panel :is(${focusables})`)).indexOf(active)
      : -1
  const selection =
    active instanceof HTMLInputElement
      ? ([active.selectionStart, active.selectionEnd] as const)
      : undefined
  const inputValue = active instanceof HTMLInputElement ? active.value : undefined
  view.dispatch({ effects: language.reconfigure(extensions(locale, label)) })
  if (index < 0) return
  const target = view.dom.querySelectorAll<HTMLElement>(`.cm-panel :is(${focusables})`)[index]
  target?.focus({ preventScroll: true })
  if (target instanceof HTMLInputElement && selection && selection[0] !== null) {
    if (inputValue !== undefined && target.value !== inputValue) target.value = inputValue
    target.setSelectionRange(selection[0], selection[1])
  }
}
