import type { CheckDiagnostic } from '@akasha/protocol'
import type { KitParseResult } from './registry.js'

export const stableIdPattern = '^[A-Za-z0-9][A-Za-z0-9._-]*$'
const stableIdRegex = new RegExp(stableIdPattern)

export function invalid(field: string, reason: string): never {
  throw new Error(`${field} ${reason}`)
}

export function parseDecision<T>(
  source: string,
  parse: (object: Record<string, unknown>) => T,
): KitParseResult<T> {
  try {
    return { ok: true, data: parse(object(JSON.parse(source), '模板源码')) }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export function decisionDiagnostics(parsed: KitParseResult<unknown>): CheckDiagnostic[] {
  return parsed.ok ? [] : [{ severity: 'error', code: 'INVALID_KIT_SOURCE', message: parsed.error }]
}

export function object(value: unknown, field: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    invalid(field, '必须为对象')
  }
  return value as Record<string, unknown>
}

export function list<T>(
  value: unknown,
  field: string,
  parse: (value: unknown, path: string) => T,
  nonempty = false,
): T[] {
  if (!Array.isArray(value) || (nonempty && !value.length)) {
    invalid(field, nonempty ? '必须为非空数组' : '必须为数组')
  }
  return value.map((item, i) => parse(item, `${field}[${i}]`))
}

export function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) invalid(field, '必须为非空字符串')
  return value
}

export function optionalText(value: unknown, field: string): string | undefined {
  return value === undefined ? undefined : text(value, field)
}

export function stableId(value: unknown, field: string): string {
  if (typeof value !== 'string' || !stableIdRegex.test(value)) {
    invalid(field, '必须为字母或数字开头，仅包含字母、数字、点、下划线或连字符的稳定标识')
  }
  return value
}

export function uniqueIndex<T>(
  values: readonly T[],
  identify: (value: T) => string,
  field: string,
): Map<string, T> {
  const result = new Map<string, T>()
  for (const value of values) {
    const id = identify(value)
    if (result.has(id)) invalid(field, `存在重复的标识 "${id}"`)
    result.set(id, value)
  }
  return result
}
