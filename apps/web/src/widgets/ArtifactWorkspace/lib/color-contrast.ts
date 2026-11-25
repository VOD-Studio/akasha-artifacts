/** WCAG 2.1 文本对比度评级结果。 */
export interface ContrastEvaluation {
  /** 对比度比值，范围 1–21。 */
  ratio: number
  /** 保留一位小数的比值文本，如 `15.0:1`。 */
  formatted: string
  /** 按字号与字重判定的 WCAG 2.1 等级。 */
  level: 'AAA' | 'AA' | 'AA-large' | 'fail'
}

interface Rgba {
  r: number
  g: number
  b: number
  a: number
}

function clampByte(value: number): number {
  return Math.min(255, Math.max(0, Math.round(value)))
}

function parseAlpha(raw: string | undefined): number {
  if (!raw) return 1
  const trimmed = raw.trim()
  const value = trimmed.endsWith('%')
    ? Number.parseFloat(trimmed.slice(0, -1)) / 100
    : Number.parseFloat(trimmed)
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 1
}

/** 解析 `#rgb`、`#rrggbb` 与 `rgb()/rgba()` 颜色值；无法识别时返回 `null`。 */
export function parseCssColor(input: string): Rgba | null {
  const value = input.trim().toLowerCase()
  const hex3 = /^#([\da-f])([\da-f])([\da-f])$/.exec(value)
  if (hex3) {
    return {
      r: Number.parseInt(hex3[1] + hex3[1], 16),
      g: Number.parseInt(hex3[2] + hex3[2], 16),
      b: Number.parseInt(hex3[3] + hex3[3], 16),
      a: 1,
    }
  }
  const hex6 = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/.exec(value)
  if (hex6) {
    return {
      r: Number.parseInt(hex6[1], 16),
      g: Number.parseInt(hex6[2], 16),
      b: Number.parseInt(hex6[3], 16),
      a: 1,
    }
  }
  const rgb =
    /^rgba?\(\s*([\d.]+)\s*[,\s]\s*([\d.]+)\s*[,\s]\s*([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(
      value,
    )
  if (!rgb) return null
  const r = Number.parseFloat(rgb[1])
  const g = Number.parseFloat(rgb[2])
  const b = Number.parseFloat(rgb[3])
  if (![r, g, b].every(Number.isFinite)) return null
  return { r: clampByte(r), g: clampByte(g), b: clampByte(b), a: parseAlpha(rgb[4]) }
}

function linearizeChannel(byte: number): number {
  const s = byte / 255
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}

function luminance({ r, g, b }: Pick<Rgba, 'r' | 'g' | 'b'>): number {
  return 0.2126 * linearizeChannel(r) + 0.7152 * linearizeChannel(g) + 0.0722 * linearizeChannel(b)
}

function compositeOver(fg: Rgba, bg: Rgba): Rgba {
  if (fg.a >= 1) return fg
  const inv = 1 - fg.a
  return {
    r: clampByte(fg.r * fg.a + bg.r * inv),
    g: clampByte(fg.g * fg.a + bg.g * inv),
    b: clampByte(fg.b * fg.a + bg.b * inv),
    a: 1,
  }
}

/**
 * 按 WCAG 2.1 计算前景色与背景色的对比度及可读性评级。
 *
 * @param options - 字号（CSS 像素）和字重用于判断大号文字阈值（≥24px 或 ≥18.66px 加粗）。
 */
export function evaluateColorContrast(
  foreground: string,
  background: string,
  options?: { fontSize?: number; fontWeight?: number },
): ContrastEvaluation | null {
  const fgRaw = parseCssColor(foreground)
  const bgRaw = parseCssColor(background)
  if (!fgRaw || !bgRaw) return null
  const opaqueBg = bgRaw.a < 1 ? compositeOver(bgRaw, { r: 255, g: 255, b: 255, a: 1 }) : bgRaw
  const fg = compositeOver(fgRaw, opaqueBg)
  const l1 = luminance(fg)
  const l2 = luminance(opaqueBg)
  const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
  const size = options?.fontSize ?? 16
  const weight = options?.fontWeight ?? 400
  const large = size >= 24 || (size >= 18.66 && weight >= 700)
  let level: ContrastEvaluation['level'] = 'fail'
  if (large) {
    if (ratio >= 4.5) level = 'AAA'
    else if (ratio >= 3) level = 'AA-large'
  } else if (ratio >= 7) {
    level = 'AAA'
  } else if (ratio >= 4.5) {
    level = 'AA'
  }
  return { ratio, formatted: `${ratio.toFixed(1)}:1`, level }
}
