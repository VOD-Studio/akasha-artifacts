import { Button } from '@akasha/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@akasha/ui/dropdown-menu'
import { Languages } from 'lucide-react'
import { useRef } from 'react'
import { type Locale, type Messages, useMessages } from './messages'

const messages = {
  界面语言: ['Oberflächensprache', 'لغة الواجهة', 'Interface language'],
} as const satisfies Messages
const names = {
  'zh-CN': '简体中文',
  en: 'English',
  de: 'Deutsch',
  ar: 'العربية',
} as const satisfies Record<Locale, string>
const locales = ['zh-CN', 'en', 'de', 'ar'] as const

/** 名称使用各语言自称；用指针从输入框切换语言时保留原焦点，键盘操作仍回到触发器。 */
export function LanguageMenu() {
  const { t, locale, setLocale, dir } = useMessages(messages)
  const prior = useRef<HTMLElement | null>(null)
  const chosen = useRef(false)
  const label = t('界面语言')
  return (
    <DropdownMenu dir={dir}>
      <DropdownMenuTrigger asChild>
        <Button
          data-language-menu=""
          variant="ghost"
          size="sm"
          iconOnly
          aria-label={label}
          title={label}
          onPointerDownCapture={(event) => {
            const active = document.activeElement
            prior.current =
              active instanceof HTMLElement &&
              active !== document.body &&
              active !== event.currentTarget
                ? active
                : null
          }}
          onKeyDownCapture={() => {
            prior.current = null
          }}
        >
          <Languages size={16} aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        data-language-menu=""
        aria-label={label}
        align="end"
        onCloseAutoFocus={(event) => {
          if (chosen.current && prior.current?.isConnected) {
            event.preventDefault()
            prior.current.focus({ preventScroll: true })
          }
          chosen.current = false
          prior.current = null
        }}
      >
        <DropdownMenuRadioGroup value={locale}>
          {locales.map((next) => (
            <DropdownMenuRadioItem
              key={next}
              value={next}
              onSelect={() => {
                chosen.current = true
                setLocale(next)
              }}
            >
              <bdi lang={next}>{names[next]}</bdi>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
