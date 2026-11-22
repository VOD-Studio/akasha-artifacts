import type { ArtifactType, CheckDiagnostic, CheckResult } from '@akasha/protocol'
import { SANDBOX_DEPENDENCY_WHITELIST, type SpecRegistry } from './spec-registry.js'

const IMPORT_RE =
  /(?:^|[\s;])(?:import\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?|require\s*\(\s*)['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/gm
const NON_LITERAL_DYNAMIC_IMPORT_RE = /\bimport\s*\(\s*(?!['"`])/g
const BLOCK_ID_RE = /\b(?:data-ak-block|id)\s*=\s*["']([^"']+)["']/g
const EXTERNAL_URL_TAG_RE = /<(?:script|link)\b[^>]*\b(?:src|href)\s*=\s*["']https?:\/\//gi

function lineNumberAt(text: string, offset: number): number {
  let line = 1
  for (let i = 0; i < offset; i++) {
    if (text.charCodeAt(i) === 10) line++
  }
  return line
}

function packageRootName(spec: string): string {
  if (spec.startsWith('@')) {
    const parts = spec.split('/')
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : spec
  }
  return spec.split('/')[0] ?? spec
}

function isWhitelisted(spec: string, whitelist: readonly string[]): boolean {
  if (spec.startsWith('.') || spec.startsWith('/')) return true
  if (whitelist.includes(spec)) return true
  const root = packageRootName(spec)
  return whitelist.includes(root)
}

function checkDuplicateBlockIds(source: string): CheckDiagnostic[] {
  const seen = new Map<string, number>()
  const diagnostics: CheckDiagnostic[] = []
  for (const m of source.matchAll(BLOCK_ID_RE)) {
    const id = m[1]
    if (!id) continue
    const line = lineNumberAt(source, m.index ?? 0)
    const firstLine = seen.get(id)
    if (firstLine !== undefined) {
      diagnostics.push({
        severity: 'error',
        code: 'DUPLICATE_BLOCK_ID',
        message: `重复的块标识 "${id}"（首次出现于第 ${firstLine} 行）`,
        line,
        suggestion: '为每个段落、标题或画板块分配唯一稳定的 id / data-ak-block',
      })
    } else {
      seen.set(id, line)
    }
  }
  return diagnostics
}

function checkUniqueArrayIds(items: unknown, label: string): CheckDiagnostic[] {
  if (!Array.isArray(items)) return []
  const seen = new Set<string>()
  const diagnostics: CheckDiagnostic[] = []
  for (const item of items) {
    if (!item || typeof item !== 'object') continue
    const id = (item as { id?: unknown }).id
    if (typeof id !== 'string' || !id) continue
    if (seen.has(id)) {
      diagnostics.push({
        severity: 'error',
        code: 'DUPLICATE_BLOCK_ID',
        message: `${label} 中存在重复的 id "${id}"`,
        suggestion: '为每个条目分配唯一且稳定的 id',
      })
    } else {
      seen.add(id)
    }
  }
  return diagnostics
}

const JSON_REQUIRED_FIELDS: Partial<Record<ArtifactType, readonly string[]>> = {
  artboard: ['boards'],
  verify: ['claims'],
  'pr-walkthrough': ['chapters'],
  'live-timeline': ['steps'],
  'option-compare': ['options'],
  'data-story': ['datasets'],
}

// 发布前静态校验门禁：在把链接发给用户前拦截越界依赖、非法 JSON、重复块 ID 与沙盒违规。
export class CheckService {
  constructor(private readonly specs: SpecRegistry) {}

  check(input: { type: ArtifactType; source: string }): CheckResult {
    const diagnostics: CheckDiagnostic[] = []
    const { type, source } = input

    if (source.trim().length === 0) {
      diagnostics.push({
        severity: 'error',
        code: 'EMPTY_SOURCE',
        message: 'Artifact 源码不能为空',
      })
      return finalize(diagnostics)
    }

    const spec = this.specs.getSpec(type)
    const whitelist = spec.whitelist.length > 0 ? spec.whitelist : SANDBOX_DEPENDENCY_WHITELIST

    if (type === 'react') {
      const stripped = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
      for (const m of stripped.matchAll(IMPORT_RE)) {
        const mod = m[1] ?? m[2]
        if (!mod) continue
        if (!isWhitelisted(mod, whitelist)) {
          diagnostics.push({
            severity: 'error',
            code: 'DISALLOWED_IMPORT',
            message: `依赖 "${mod}" 不在沙盒白名单内`,
            line: lineNumberAt(stripped, m.index ?? 0),
            suggestion: `仅可使用白名单依赖：${whitelist.join(', ')}`,
          })
        }
      }
      for (const m of stripped.matchAll(NON_LITERAL_DYNAMIC_IMPORT_RE)) {
        diagnostics.push({
          severity: 'error',
          code: 'DYNAMIC_IMPORT_DISALLOWED',
          message: '沙盒禁止使用非常量表达式的动态 import()',
          line: lineNumberAt(stripped, m.index ?? 0),
          suggestion: '请改为静态 import 白名单依赖',
        })
      }
      if (!/export\s+default\b/.test(stripped)) {
        diagnostics.push({
          severity: 'warning',
          code: 'MISSING_DEFAULT_EXPORT',
          message: 'React Artifact 未检测到 export default 组件导出',
          suggestion: '请导出默认组件：export default function App() { ... }',
        })
      }
      if (/\bfetch\s*\(/.test(stripped)) {
        diagnostics.push({
          severity: 'warning',
          code: 'SANDBOX_NETWORK_BLOCKED',
          message: '沙盒 CSP 禁止直接外联（connect-src none），fetch 调用会被拦截',
          suggestion: '由 Agent 在终端获取数据后通过源码或 artifact_push_state 注入',
        })
      }
    }

    if (type === 'html' || type === 'document') {
      if (type === 'document' && source.trim().startsWith('{')) {
        try {
          const parsed = JSON.parse(source) as Record<string, unknown>
          if (!Array.isArray(parsed.sections)) {
            diagnostics.push({
              severity: 'error',
              code: 'MISSING_REQUIRED_FIELD',
              message: 'JSON 格式 document 缺少必需数组字段 "sections"',
            })
          } else {
            const allBlocks: Array<{ id?: unknown }> = []
            for (const sec of parsed.sections) {
              if (!sec || typeof sec !== 'object') continue
              const s = sec as { id?: unknown; paragraphs?: unknown; questions?: unknown }
              allBlocks.push({ id: s.id })
              if (Array.isArray(s.paragraphs)) {
                for (const p of s.paragraphs) {
                  if (p && typeof p === 'object') allBlocks.push({ id: (p as { id?: unknown }).id })
                }
              }
              if (Array.isArray(s.questions)) {
                for (const q of s.questions) {
                  if (q && typeof q === 'object') allBlocks.push({ id: (q as { id?: unknown }).id })
                }
              }
            }
            diagnostics.push(...checkUniqueArrayIds(allBlocks, 'document blocks'))
          }
        } catch (err) {
          diagnostics.push({
            severity: 'error',
            code: 'INVALID_JSON',
            message: `JSON 解析失败：${err instanceof Error ? err.message : String(err)}`,
          })
        }
      } else {
        for (const m of source.matchAll(EXTERNAL_URL_TAG_RE)) {
          diagnostics.push({
            severity: 'warning',
            code: 'EXTERNAL_RESOURCE_BLOCKED',
            message: '沙盒禁止加载外部网络脚本或样式，请使用内联样式或预置资源',
            line: lineNumberAt(source, m.index ?? 0),
          })
        }
        diagnostics.push(...checkDuplicateBlockIds(source))
      }
    }

    if (type === 'svg') {
      if (!/<svg\b/i.test(source)) {
        diagnostics.push({
          severity: 'error',
          code: 'INVALID_SVG_ROOT',
          message: 'SVG Artifact 必须包含 <svg> 根元素',
        })
      }
      if (/<script\b/i.test(source) || /\bon[a-z]+\s*=/i.test(source)) {
        diagnostics.push({
          severity: 'error',
          code: 'DISALLOWED_SVG_SCRIPT',
          message: 'SVG Artifact 禁止包含 <script> 或内联事件属性',
        })
      }
    }

    const requiredFields = JSON_REQUIRED_FIELDS[type]
    if (requiredFields) {
      try {
        const parsed = JSON.parse(source) as unknown
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
          diagnostics.push({
            severity: 'error',
            code: 'INVALID_JSON_OBJECT',
            message: `类型 "${type}" 须为 JSON 对象`,
          })
        } else {
          const record = parsed as Record<string, unknown>
          for (const field of requiredFields) {
            if (!(field in record)) {
              diagnostics.push({
                severity: 'error',
                code: 'MISSING_REQUIRED_FIELD',
                message: `类型 "${type}" 缺少必需字段 "${field}"`,
              })
            }
          }
          // 校验各结构化模板内部条目的 ID 唯一性与引用一致性
          if (type === 'live-timeline') {
            diagnostics.push(...checkUniqueArrayIds(record.steps, 'live-timeline.steps'))
          } else if (type === 'option-compare') {
            diagnostics.push(...checkUniqueArrayIds(record.options, 'option-compare.options'))
            const optionIds = new Set(
              Array.isArray(record.options)
                ? record.options
                    .map((o) =>
                      o && typeof o === 'object' ? (o as { id?: unknown }).id : undefined,
                    )
                    .filter((id): id is string => typeof id === 'string')
                : [],
            )
            if (
              typeof record.recommended === 'string' &&
              optionIds.size > 0 &&
              !optionIds.has(record.recommended)
            ) {
              diagnostics.push({
                severity: 'warning',
                code: 'UNKNOWN_RECOMMENDED_OPTION',
                message: `推荐方案 "${record.recommended}" 未在 options 中定义`,
              })
            }
          } else if (type === 'verify') {
            diagnostics.push(...checkUniqueArrayIds(record.claims, 'verify.claims'))
            diagnostics.push(...checkUniqueArrayIds(record.screens, 'verify.screens'))
            diagnostics.push(...checkUniqueArrayIds(record.unverified, 'verify.unverified'))
          } else if (type === 'artboard') {
            diagnostics.push(...checkUniqueArrayIds(record.boards, 'artboard.boards'))
            const boardIds = new Set(
              Array.isArray(record.boards)
                ? record.boards
                    .map((b) =>
                      b && typeof b === 'object' ? (b as { id?: unknown }).id : undefined,
                    )
                    .filter((id): id is string => typeof id === 'string')
                : [],
            )
            if (Array.isArray(record.flows)) {
              for (const f of record.flows) {
                if (!f || typeof f !== 'object') continue
                const flow = f as { from?: unknown; to?: unknown }
                if (
                  typeof flow.from === 'string' &&
                  typeof flow.to === 'string' &&
                  boardIds.size > 0 &&
                  (!boardIds.has(flow.from) || !boardIds.has(flow.to))
                ) {
                  diagnostics.push({
                    severity: 'warning',
                    code: 'UNKNOWN_FLOW_ENDPOINT',
                    message: `流程连线 "${flow.from} -> ${flow.to}" 引用了未定义的画板 id`,
                  })
                }
              }
            }
            if (Array.isArray(record.groups)) {
              for (const g of record.groups) {
                if (!g || typeof g !== 'object') continue
                const group = g as { id?: string; recommended?: string; options?: unknown }
                if (
                  typeof group.recommended === 'string' &&
                  boardIds.size > 0 &&
                  !boardIds.has(group.recommended)
                ) {
                  diagnostics.push({
                    severity: 'warning',
                    code: 'UNKNOWN_RECOMMENDED_BOARD',
                    message: `分组 "${group.id ?? '?'}" 的 recommended="${group.recommended}" 未在 boards 中定义`,
                  })
                }
              }
            }
          }
        }
      } catch (err) {
        diagnostics.push({
          severity: 'error',
          code: 'INVALID_JSON',
          message: `JSON 解析失败：${err instanceof Error ? err.message : String(err)}`,
        })
      }
    }

    const customValidator = this.specs.getDefinition(type)?.validate
    if (customValidator) {
      diagnostics.push(...customValidator(source))
    }

    return finalize(diagnostics)
  }
}

function finalize(diagnostics: CheckDiagnostic[]): CheckResult {
  const errors = diagnostics.filter((d) => d.severity === 'error')
  const warnings = diagnostics.filter((d) => d.severity === 'warning')
  return {
    ok: errors.length === 0,
    errors,
    warnings,
  }
}
