import { type ChangeEvent, type FocusEvent, type ReactNode, useState } from 'react'

interface InspectorRowProps {
  label: string
  htmlFor?: string
  children: ReactNode
}

/** 紧凑水平键值行，用于检查器面板中替代竖向堆叠的表单 Field。 */
export function InspectorRow({ label, htmlFor, children }: InspectorRowProps) {
  return (
    <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-2">
      {htmlFor ? (
        <label htmlFor={htmlFor} className="truncate text-xs text-ink-muted">
          {label}
        </label>
      ) : (
        <span className="truncate text-xs text-ink-muted">{label}</span>
      )}
      <div className="min-w-0">{children}</div>
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
}

/** 单行紧凑数字框，隐藏浏览器原生增减箭头，保留原生数字校验与无障碍角色。 */
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
}: InspectorNumberInputProps) {
  const displayValue = typeof value === 'number' && Number.isNaN(value) ? '' : value
  return (
    <div
      className={`flex h-7 min-w-0 items-center gap-1 rounded-md border px-2 transition-colors ${
        invalid
          ? 'border-destructive/75 bg-surface focus-within:border-destructive'
          : 'border-transparent bg-surface-subtle hover:border-border/60 focus-within:border-(--canvas-selection) focus-within:bg-surface'
      } ${disabled ? 'opacity-55' : ''}`}
    >
      {prefix ? (
        <span
          aria-hidden="true"
          className="shrink-0 select-none text-[11px] font-medium text-ink-muted"
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
        className="min-w-0 flex-1 bg-transparent text-xs tabular-nums text-ink outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        onChange={onChange}
        onBlur={onBlur}
      />
      {suffix ? (
        <span aria-hidden="true" className="shrink-0 select-none text-[11px] text-ink-muted">
          {suffix}
        </span>
      ) : null}
    </div>
  )
}

interface InspectorColorInputProps {
  id?: string
  label: string
  value: string
  disabled?: boolean
  onChange: (hex: string) => void
}

const HEX_COLOR = /^#[0-9a-f]{6}$/i

/** 整合色块取色与十六进制输入的紧凑控件，避免原生 color 输入框出现双层边框。 */
export function InspectorColorInput({
  id,
  label,
  value,
  disabled,
  onChange,
}: InspectorColorInputProps) {
  const normalized = HEX_COLOR.test(value) ? value.toLowerCase() : '#ffffff'
  const [hexDraft, setHexDraft] = useState<string | null>(null)
  const displayed = hexDraft ?? normalized.toUpperCase()

  return (
    <div
      className={`flex h-7 min-w-0 items-center gap-2 rounded-md border border-transparent bg-surface-subtle px-2 transition-colors hover:border-border/60 focus-within:border-(--canvas-selection) focus-within:bg-surface ${
        disabled ? 'opacity-55' : ''
      }`}
    >
      <label className="relative inline-flex size-4 shrink-0 cursor-pointer overflow-hidden rounded-[4px] border border-black/15 dark:border-white/20">
        <span className="sr-only">{label}</span>
        <input
          id={id}
          type="color"
          disabled={disabled}
          value={normalized}
          className="absolute inset-0 size-full cursor-pointer opacity-0"
          onChange={(event) => {
            setHexDraft(null)
            onChange(event.currentTarget.value.toLowerCase())
          }}
        />
        <span aria-hidden="true" className="size-full" style={{ backgroundColor: normalized }} />
      </label>
      <input
        type="text"
        dir="ltr"
        spellCheck={false}
        disabled={disabled}
        aria-label={`${label} HEX`}
        value={displayed}
        className="min-w-0 flex-1 bg-transparent font-mono text-xs text-ink uppercase outline-none"
        onChange={(event) => {
          const next = event.currentTarget.value.trim()
          setHexDraft(next)
          if (HEX_COLOR.test(next)) onChange(next.toLowerCase())
        }}
        onBlur={() => setHexDraft(null)}
      />
    </div>
  )
}
