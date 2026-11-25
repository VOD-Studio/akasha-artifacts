import type { CheckDiagnostic } from '@akasha/protocol'
import type { KitParseResult } from '../registry.js'

export function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null
}

export function asString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined
}

export function asBoolean(v: unknown): boolean | undefined {
  return typeof v === 'boolean' ? v : undefined
}

export function asNumber(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

export function asStringArray(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined
  return v.filter((item): item is string => typeof item === 'string')
}

export function parseJsonObject(source: string): KitParseResult<Record<string, unknown>> {
  try {
    const parsed = JSON.parse(source) as unknown
    const rec = asRecord(parsed)
    if (!rec) return { ok: false, error: '模板源码必须为 JSON 对象' }
    return { ok: true, data: rec }
  } catch (err) {
    return {
      ok: false,
      error: `JSON 解析失败：${err instanceof Error ? err.message : String(err)}`,
    }
  }
}

export function checkUniqueIds(
  items: readonly { id: string }[],
  label: string,
  code = 'DUPLICATE_BLOCK_ID',
): CheckDiagnostic[] {
  const seen = new Set<string>()
  const out: CheckDiagnostic[] = []
  for (const item of items) {
    if (seen.has(item.id)) {
      out.push({
        severity: 'error',
        code,
        message: `${label} 存在重复的 id "${item.id}"`,
        suggestion: '请确保每个条目的 id 唯一且稳定',
      })
    } else {
      seen.add(item.id)
    }
  }
  return out
}
