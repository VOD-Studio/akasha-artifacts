import type { UiLocale } from '@akasha/ui/locale'
import { useMemo, useSyncExternalStore } from 'react'

/** 外壳支持的语言；不决定作者内容的语言。 */
export type Locale = UiLocale

type Plural = { other: string } & Partial<Record<Intl.LDMLPluralRule, string>>
type Translation = string | Plural
/** 中文原文为键；译文依次为德语、阿拉伯语、英语。缺少任一语言时无法通过类型检查。 */
export type Messages = Readonly<
  Record<string, readonly [de: Translation, ar: Translation, en: Translation]>
>
type Params = Readonly<Record<string, string | number>>
const storageKey = 'akasha.shell.locale'

function supported(value: string | null): value is Locale {
  return value === 'zh-CN' || value === 'en' || value === 'de' || value === 'ar'
}

function initialLocale(): Locale {
  try {
    const stored = localStorage.getItem(storageKey)
    if (supported(stored)) return stored
  } catch {
    // 限制持久化的页面仍能在本次会话中切换语言。
  }
  return 'zh-CN'
}

let current = initialLocale()
const listeners = new Set<() => void>()
const readLocale = () => current

function update(locale: Locale) {
  if (current === locale) return
  current = locale
  for (const listener of listeners) listener()
}

function onStorage(event: StorageEvent) {
  if (event.key === storageKey || event.key === null) update(initialLocale())
}

function subscribe(listener: () => void) {
  if (!listeners.size) window.addEventListener('storage', onStorage)
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
    if (!listeners.size) window.removeEventListener('storage', onStorage)
  }
}

/** 仅更新浏览器的外壳偏好；不导航、不刷新路由，也不向服务端写入。 */
export function setLocale(locale: Locale) {
  try {
    localStorage.setItem(storageKey, locale)
  } catch {
    // 禁用存储不阻止本会话切换。
  }
  update(locale)
}

const localeState = {
  'zh-CN': { locale: 'zh-CN', dir: 'ltr', setLocale },
  en: { locale: 'en', dir: 'ltr', setLocale },
  de: { locale: 'de', dir: 'ltr', setLocale },
  ar: { locale: 'ar', dir: 'rtl', setLocale },
} as const

/** 订阅界面偏好；过渡中的菜单、输入框和画板不因切换语言而重新挂载。 */
export function useLocale() {
  return localeState[useSyncExternalStore(subscribe, readLocale, readLocale)]
}

// 不依赖宿主的地区默认值，阿拉伯语界面统一使用 ٠١٢٣٤٥٦٧٨٩。
const tags = { 'zh-CN': 'zh-CN', en: 'en', de: 'de', ar: 'ar-u-nu-arab' } as const
const translationIndex = { de: 0, ar: 1, en: 2 } as const
const formats = new Map<
  Locale,
  { numeric: Intl.NumberFormat; plural: Intl.PluralRules; date: Intl.DateTimeFormat }
>()
function forLocale(locale: Locale) {
  const existing = formats.get(locale)
  if (existing) return existing
  const tag = tags[locale]
  const result = {
    numeric: new Intl.NumberFormat(tag),
    plural: new Intl.PluralRules(tag),
    date: new Intl.DateTimeFormat(tag),
  }
  formats.set(locale, result)
  return result
}

/** 非 React 消费者在展示时读取同一语言；显式 locale 可冻结当前输出任务的语言。 */
export function getMessages<C extends Messages>(catalog: C, locale: Locale = current) {
  const { numeric, plural, date: calendar } = forLocale(locale)
  const t = (key: keyof C & string, params?: Params): string => {
    let message: Translation = key
    if (locale !== 'zh-CN') message = catalog[key][translationIndex[locale]]
    if (typeof message !== 'string') {
      const count = params?.count
      message = (typeof count === 'number' && message[plural.select(count)]) || message.other
    }
    if (!params) return message
    return message.replace(/\{(\w+)\}/g, (original, name: string) => {
      const value = params[name]
      if (typeof value === 'number') return numeric.format(value)
      return value ?? original
    })
  }
  const number = (value: number, options?: Intl.NumberFormatOptions) =>
    (options ? new Intl.NumberFormat(tags[locale], options) : numeric).format(value)
  const date = (value: string | number | Date, options?: Intl.DateTimeFormatOptions) =>
    (options ? new Intl.DateTimeFormat(tags[locale], options) : calendar).format(
      typeof value === 'string' ? new Date(value) : value,
    )
  return { ...localeState[locale], t, number, date }
}

/** 只在界面语言或词表更换时替换格式化函数，供含状态的消费面复用。 */
export function useMessages<C extends Messages>(catalog: C) {
  const { locale } = useLocale()
  return useMemo(() => getMessages(catalog, locale), [catalog, locale])
}
