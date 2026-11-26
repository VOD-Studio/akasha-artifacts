import { Popover, PopoverContent, PopoverTrigger } from '@akasha/ui/popover'
import { ChevronRight, Pipette, X } from 'lucide-react'
import {
  type ChangeEvent,
  type FocusEvent,
  type KeyboardEvent,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useRef,
  useState,
} from 'react'

interface InspectorSectionProps {
  title: string
  ariaLabel?: string
  action?: ReactNode
  collapsible?: boolean
  defaultOpen?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
  children: ReactNode
}

/** 检查器全宽分隔模块，支持常驻展开或点击标题行折叠展开。 */
export function InspectorSection({
  title,
  ariaLabel,
  action,
  collapsible = false,
  defaultOpen = false,
  open,
  onOpenChange,
  children,
}: InspectorSectionProps) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen)
  const isOpen = collapsible ? (open ?? internalOpen) : true

  const toggle = () => {
    const next = !isOpen
    if (open === undefined) setInternalOpen(next)
    onOpenChange?.(next)
  }

  if (collapsible) {
    return (
      <section aria-label={ariaLabel} className="border-b border-border/75">
        <button
          type="button"
          aria-expanded={isOpen}
          className="flex w-full items-center justify-between gap-2 px-4 py-3 text-start text-[13px] font-semibold text-ink transition-colors hover:text-ink/80 focus-visible:ring-2 focus-visible:ring-(--canvas-selection) focus-visible:outline-none focus-visible:ring-inset"
          onClick={toggle}
        >
          <span className="min-w-0 truncate">{title}</span>
          <ChevronRight
            size={14}
            aria-hidden="true"
            className={`shrink-0 text-ink-muted transition-transform duration-150 ${
              isOpen ? 'rotate-90' : ''
            }`}
          />
        </button>
        {isOpen ? <div className="space-y-2.5 px-4 pb-3.5">{children}</div> : null}
      </section>
    )
  }

  return (
    <section aria-label={ariaLabel} className="border-b border-border/75 px-4 py-3.5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-[13px] font-semibold text-ink">{title}</h3>
        {action}
      </div>
      <div className="space-y-2.5">{children}</div>
    </section>
  )
}

interface InspectorRowProps {
  label: string
  htmlFor?: string
  children: ReactNode
}

/** 左标签右控件的紧凑水平行，标签允许长 CSS 属性名自然折行。 */
export function InspectorRow({ label, htmlFor, children }: InspectorRowProps) {
  return (
    <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] items-center gap-2">
      {htmlFor ? (
        <label htmlFor={htmlFor} className="text-[13px] leading-snug text-ink-muted wrap-anywhere">
          {label}
        </label>
      ) : (
        <span className="text-[13px] leading-snug text-ink-muted wrap-anywhere">{label}</span>
      )}
      <div className="min-w-0">{children}</div>
    </div>
  )
}

interface InspectorValuePillProps {
  prefix?: string
  suffix?: string
  dir?: 'ltr' | 'rtl'
  mono?: boolean
  children: ReactNode
}

/** 只读属性或计算样式值的浅灰圆角块，与可编辑控件保持统一节奏。 */
export function InspectorValuePill({
  prefix,
  suffix,
  dir = 'ltr',
  mono = false,
  children,
}: InspectorValuePillProps) {
  return (
    <div
      dir={dir}
      className="flex min-h-8 min-w-0 items-center justify-between gap-2 rounded-[8px] bg-surface-subtle px-2.5 py-1.5 text-[13px] text-ink"
    >
      <span className="flex min-w-0 flex-1 items-center gap-1.5">
        {prefix ? (
          <span aria-hidden="true" className="shrink-0 text-xs font-medium text-ink-muted">
            {prefix}
          </span>
        ) : null}
        <span className={`min-w-0 truncate ${mono ? 'font-mono text-xs' : 'tabular-nums'}`}>
          {children}
        </span>
      </span>
      {suffix ? (
        <span aria-hidden="true" className="shrink-0 text-xs text-ink-muted">
          {suffix}
        </span>
      ) : null}
    </div>
  )
}

interface InspectorNumberInputProps {
  id?: string
  label: string
  value: number | string
  prefix?: string
  suffix?: string
  min?: number
  max?: number
  step?: number | 'any'
  required?: boolean
  disabled?: boolean
  invalid?: boolean
  onChange: (event: ChangeEvent<HTMLInputElement>) => void
  onBlur?: (event: FocusEvent<HTMLInputElement>) => void
  onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void
}

/** 单行浅灰无框数字输入，隐藏浏览器增减箭头，保留原生数字校验与无障碍角色。 */
export function InspectorNumberInput({
  id,
  label,
  value,
  prefix,
  suffix,
  min,
  max,
  step,
  required,
  disabled,
  invalid,
  onChange,
  onBlur,
  onKeyDown,
}: InspectorNumberInputProps) {
  const displayValue = typeof value === 'number' && Number.isNaN(value) ? '' : value
  return (
    <div
      className={`flex h-8 min-w-0 items-center gap-1.5 rounded-[8px] border px-2.5 transition-colors ${
        invalid
          ? 'border-destructive/75 bg-surface focus-within:border-destructive'
          : 'border-transparent bg-surface-subtle hover:border-border/60 focus-within:border-(--canvas-selection) focus-within:bg-surface'
      } ${disabled ? 'opacity-55' : ''}`}
    >
      {prefix ? (
        <span
          aria-hidden="true"
          className="shrink-0 select-none text-xs font-medium text-ink-muted"
        >
          {prefix}
        </span>
      ) : null}
      <input
        id={id}
        type="number"
        dir="ltr"
        aria-label={label}
        aria-invalid={invalid || undefined}
        title={label}
        min={min}
        max={max}
        step={step}
        required={required}
        disabled={disabled}
        value={displayValue}
        className="min-w-0 flex-1 bg-transparent text-[13px] tabular-nums text-ink outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        onChange={onChange}
        onBlur={onBlur}
        onKeyDown={onKeyDown}
      />
      {suffix ? (
        <span aria-hidden="true" className="shrink-0 select-none text-xs text-ink-muted">
          {suffix}
        </span>
      ) : null}
    </div>
  )
}

const HEX_COLOR = /^#[0-9a-f]{6}$/i
const QUICK_SWATCHES = [
  '#ffffff',
  '#f5f4f0',
  '#1c1b19',
  '#2563eb',
  '#c1672a',
  '#0f766e',
  '#be123c',
  '#7c3aed',
] as const

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value))
}

function hexToHsv(hex: string): [number, number, number] {
  const clean = HEX_COLOR.test(hex) ? hex.slice(1) : 'ffffff'
  const r = Number.parseInt(clean.slice(0, 2), 16) / 255
  const g = Number.parseInt(clean.slice(2, 4), 16) / 255
  const b = Number.parseInt(clean.slice(4, 6), 16) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const delta = max - min
  let h = 0
  if (delta > 0) {
    if (max === r) h = 60 * (((g - b) / delta) % 6)
    else if (max === g) h = 60 * ((b - r) / delta + 2)
    else h = 60 * ((r - g) / delta + 4)
  }
  if (h < 0) h += 360
  const s = max === 0 ? 0 : delta / max
  return [h, s, max]
}

function hsvToHex(h: number, s: number, v: number): string {
  const c = v * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = v - c
  let r = 0
  let g = 0
  let b = 0
  if (h < 60) [r, g, b] = [c, x, 0]
  else if (h < 120) [r, g, b] = [x, c, 0]
  else if (h < 180) [r, g, b] = [0, c, x]
  else if (h < 240) [r, g, b] = [0, x, c]
  else if (h < 300) [r, g, b] = [x, 0, c]
  else [r, g, b] = [c, 0, x]
  const toHex = (channel: number) =>
    Math.round((channel + m) * 255)
      .toString(16)
      .padStart(2, '0')
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}

interface EyeDropperResult {
  sRGBHex: string
}

interface EyeDropperCtor {
  new (): { open: () => Promise<EyeDropperResult> }
}

interface InspectorColorInputProps {
  id?: string
  label: string
  value: string
  disabled?: boolean
  /** 实时拖动时的本地预览回调；若未提供 onCommit，则变更直接生效。 */
  onChange: (hex: string) => void
  /** 拖动松手、点选预设或确认十六进制时触发持久化提交。 */
  onCommit?: (hex: string) => void
}

/** 定制浮层取色器 + 行内十六进制输入，替代观感粗糙的浏览器原生 color 弹窗。 */
export function InspectorColorInput({
  id,
  label,
  value,
  disabled,
  onChange,
  onCommit,
}: InspectorColorInputProps) {
  const normalized = HEX_COLOR.test(value) ? value.toLowerCase() : '#ffffff'
  const [open, setOpen] = useState(false)
  const [hsv, setHsv] = useState<[number, number, number]>(() => hexToHsv(normalized))
  const [hexDraft, setHexDraft] = useState<string | null>(null)
  const latestHexRef = useRef(normalized)
  const svAreaRef = useRef<HTMLDivElement>(null)
  const hueBarRef = useRef<HTMLDivElement>(null)

  const displayHex = open ? hsvToHex(hsv[0], hsv[1], hsv[2]) : normalized
  const displayedText = hexDraft ?? displayHex.toUpperCase()
  const [hue, sat, val] = open ? hsv : hexToHsv(normalized)

  const commit = (next: string) => {
    latestHexRef.current = next
    onChange(next)
    onCommit?.(next)
  }

  const updateSv = (clientX: number, clientY: number) => {
    const area = svAreaRef.current
    if (!area) return
    const rect = area.getBoundingClientRect()
    if (!rect.width || !rect.height) return
    const nextS = clamp01((clientX - rect.left) / rect.width)
    const nextV = clamp01(1 - (clientY - rect.top) / rect.height)
    const nextHex = hsvToHex(hue, nextS, nextV)
    setHsv([hue, nextS, nextV])
    setHexDraft(null)
    latestHexRef.current = nextHex
    onChange(nextHex)
  }

  const updateHue = (clientX: number) => {
    const bar = hueBarRef.current
    if (!bar) return
    const rect = bar.getBoundingClientRect()
    if (!rect.width) return
    const nextH = clamp01((clientX - rect.left) / rect.width) * 360
    const nextHex = hsvToHex(nextH, sat, val)
    setHsv([nextH, sat, val])
    setHexDraft(null)
    latestHexRef.current = nextHex
    onChange(nextHex)
  }

  const startSvDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled || event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    updateSv(event.clientX, event.clientY)
    const onMove = (moveEvent: PointerEvent) => updateSv(moveEvent.clientX, moveEvent.clientY)
    const onEnd = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onEnd)
      window.removeEventListener('pointercancel', onEnd)
      onCommit?.(latestHexRef.current)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onEnd)
    window.addEventListener('pointercancel', onEnd)
  }

  const startHueDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled || event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    updateHue(event.clientX)
    const onMove = (moveEvent: PointerEvent) => updateHue(moveEvent.clientX)
    const onEnd = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onEnd)
      window.removeEventListener('pointercancel', onEnd)
      onCommit?.(latestHexRef.current)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onEnd)
    window.addEventListener('pointercancel', onEnd)
  }

  const eyeDropperCtor =
    typeof window !== 'undefined'
      ? ((window as unknown as { EyeDropper?: EyeDropperCtor }).EyeDropper ?? null)
      : null

  const pickWithEyeDropper = async () => {
    if (!eyeDropperCtor || disabled) return
    try {
      const result = await new eyeDropperCtor().open()
      const picked = result.sRGBHex.toLowerCase()
      if (HEX_COLOR.test(picked)) {
        setHsv(hexToHsv(picked))
        setHexDraft(null)
        commit(picked)
      }
    } catch {
      // 用户按 Escape 取消取色时保持原值。
    }
  }

  const handleHexChange = (raw: string) => {
    const trimmed = raw.trim()
    setHexDraft(trimmed)
    const withHash = trimmed.startsWith('#') ? trimmed : `#${trimmed}`
    if (HEX_COLOR.test(withHash)) {
      const next = withHash.toLowerCase()
      setHsv(hexToHsv(next))
      latestHexRef.current = next
      onChange(next)
    }
  }

  const commitHexDraft = () => {
    if (hexDraft !== null) {
      const trimmed = hexDraft.trim()
      const withHash = trimmed.startsWith('#') ? trimmed : `#${trimmed}`
      if (HEX_COLOR.test(withHash)) {
        const next = withHash.toLowerCase()
        setHsv(hexToHsv(next))
        commit(next)
      }
      setHexDraft(null)
    }
  }

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) {
          setHsv(hexToHsv(normalized))
          latestHexRef.current = normalized
        }
        setOpen(nextOpen)
      }}
    >
      <div
        className={`flex h-8 min-w-0 items-center gap-2.5 rounded-[8px] border border-transparent bg-surface-subtle px-2 transition-colors hover:border-border/60 focus-within:border-(--canvas-selection) focus-within:bg-surface ${
          disabled ? 'opacity-55' : ''
        }`}
      >
        <PopoverTrigger asChild>
          <button
            id={id}
            type="button"
            disabled={disabled}
            aria-label={label}
            className="inline-flex size-5 shrink-0 cursor-pointer overflow-hidden rounded-[5px] border border-black/12 transition-transform hover:scale-105 focus-visible:ring-2 focus-visible:ring-(--canvas-selection) focus-visible:outline-none dark:border-white/18"
            style={{ backgroundColor: displayHex }}
          />
        </PopoverTrigger>
        <input
          type="text"
          dir="ltr"
          spellCheck={false}
          disabled={disabled}
          aria-label={`${label} HEX`}
          value={displayedText}
          className="min-w-0 flex-1 bg-transparent font-mono text-[13px] text-ink uppercase outline-none"
          onChange={(event) => handleHexChange(event.currentTarget.value)}
          onBlur={commitHexDraft}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              commitHexDraft()
              event.currentTarget.blur()
            } else if (event.key === 'Escape') {
              setHexDraft(null)
              event.currentTarget.blur()
            }
          }}
        />
      </div>
      <PopoverContent
        side="left"
        align="start"
        sideOffset={12}
        className="w-64 space-y-3 rounded-[14px] p-3.5"
        aria-label={label}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-[13px] font-semibold text-ink">{label}</span>
          <button
            type="button"
            aria-label="关闭"
            className="inline-flex size-6 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-surface-subtle hover:text-ink"
            onClick={() => setOpen(false)}
          >
            <X size={14} aria-hidden="true" />
          </button>
        </div>

        <div
          ref={svAreaRef}
          onPointerDown={startSvDrag}
          className="relative h-36 w-full cursor-crosshair touch-none overflow-hidden rounded-[10px] select-none"
          style={{
            backgroundColor: `hsl(${Math.round(hue)} 100% 50%)`,
            backgroundImage:
              'linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, transparent)',
          }}
        >
          <span
            aria-hidden="true"
            className="pointer-events-none absolute size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_1px_4px_rgba(0,0,0,0.4)]"
            style={{
              left: `${sat * 100}%`,
              top: `${(1 - val) * 100}%`,
              backgroundColor: displayHex,
            }}
          />
        </div>

        <div
          ref={hueBarRef}
          onPointerDown={startHueDrag}
          className="relative h-3.5 w-full cursor-ew-resize touch-none rounded-full select-none"
          style={{
            backgroundImage:
              'linear-gradient(to right, #ff0000 0%, #ffff00 17%, #00ff00 33%, #00ffff 50%, #0000ff 67%, #ff00ff 83%, #ff0000 100%)',
          }}
        >
          <span
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_1px_4px_rgba(0,0,0,0.35)]"
            style={{
              left: `${(hue / 360) * 100}%`,
              backgroundColor: `hsl(${Math.round(hue)} 100% 50%)`,
            }}
          />
        </div>

        <div className="flex items-center gap-2">
          {eyeDropperCtor ? (
            <button
              type="button"
              aria-label="吸色"
              className="inline-flex size-8 shrink-0 items-center justify-center rounded-[8px] text-ink-muted transition-colors hover:bg-surface-subtle hover:text-ink"
              onClick={() => void pickWithEyeDropper()}
            >
              <Pipette size={14} aria-hidden="true" />
            </button>
          ) : null}
          <div className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-[8px] bg-surface-subtle px-2.5">
            <input
              type="text"
              dir="ltr"
              spellCheck={false}
              aria-label={`${label} HEX`}
              value={displayedText}
              className="min-w-0 flex-1 bg-transparent font-mono text-[13px] text-ink uppercase outline-none"
              onChange={(event) => handleHexChange(event.currentTarget.value)}
              onBlur={commitHexDraft}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  commitHexDraft()
                }
              }}
            />
          </div>
        </div>

        <div className="grid grid-cols-8 gap-1.5 pt-0.5">
          {QUICK_SWATCHES.map((swatch) => {
            const selected = swatch === displayHex
            return (
              <button
                key={swatch}
                type="button"
                aria-label={swatch.toUpperCase()}
                className={`size-5.5 cursor-pointer rounded-[6px] border transition-transform hover:scale-110 ${
                  selected
                    ? 'ring-2 ring-(--canvas-selection) ring-offset-1 border-black/15'
                    : 'border-black/12 dark:border-white/15'
                }`}
                style={{ backgroundColor: swatch }}
                onClick={() => {
                  setHsv(hexToHsv(swatch))
                  setHexDraft(null)
                  commit(swatch)
                }}
              />
            )
          })}
        </div>
      </PopoverContent>
    </Popover>
  )
}
