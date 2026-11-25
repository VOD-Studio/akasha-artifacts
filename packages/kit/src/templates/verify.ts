import type { Verdict } from '@akasha/protocol'
import {
  buildPropsJsonSchema,
  type KitParseResult,
  type KitPropField,
  type KitTemplateDefinition,
} from '../registry.js'
import {
  asBoolean,
  asRecord,
  asString,
  checkUniqueIds,
  parseJsonObject,
} from './source-validation.js'

/**
 * 声明状态：`checked` 已验证；`failed` 验证失败；
 * `updated` 修复后待重验；`pending` 待验证。
 */
export type VerifyClaimStatus = 'checked' | 'failed' | 'updated' | 'pending'

/** 预期界面与实际界面的并排对比。 */
export interface VerifyScreenComparison {
  id: string
  title: string
  expectedLabel: string
  actualLabel: string
  /** 预期界面的 HTML 片段。 */
  expectedHtml?: string
  /** 实际界面的 HTML 片段。 */
  actualHtml?: string
  diffNote?: string
}

/** 一条可验证的声明；`id` 用来匹配状态流里的 `claimOverrides` 与 `verdicts`。 */
export interface VerifyClaim {
  id: string
  title: string
  status: VerifyClaimStatus
  summary?: string
  /** 产出证据的命令。 */
  command?: string
  /** 命令的原始输出。 */
  evidence?: string
  verdict?: Verdict
  updatedAt?: string
}

/** 未验证项及其原因。 */
export interface VerifyUnverifiedItem {
  id: string
  title: string
  reason: string
  risk: 'low' | 'medium' | 'high'
}

/** `verify` 模板的数据。 */
export interface VerifyData {
  title: string
  summary?: string
  showUnverified: boolean
  filterStatus: 'all' | VerifyClaimStatus
  screens: VerifyScreenComparison[]
  claims: VerifyClaim[]
  unverified: VerifyUnverifiedItem[]
}

const VALID_CLAIM_STATUS = new Set<VerifyClaimStatus>(['checked', 'failed', 'updated', 'pending'])
const VALID_VERDICTS = new Set<Verdict>(['pass', 'reject', 'waive'])

export const VERIFY_PROP_FIELDS: readonly KitPropField[] = [
  {
    key: 'filterStatus',
    label: '声明状态筛选',
    type: 'select',
    defaultValue: 'all',
    options: [
      { value: 'all', label: '全部声明' },
      { value: 'checked', label: '已验证' },
      { value: 'updated', label: '修复待重验' },
      { value: 'failed', label: '验证失败' },
      { value: 'pending', label: '待验证' },
    ],
  },
  {
    key: 'showUnverified',
    label: '展示未验证项清单',
    type: 'boolean',
    defaultValue: true,
  },
]

export function parseVerify(source: string): KitParseResult<VerifyData> {
  const res = parseJsonObject(source)
  if (!res.ok) return res
  const rawClaims = res.data.claims
  if (!Array.isArray(rawClaims)) {
    return { ok: false, error: 'verify 缺少数组字段 "claims"' }
  }

  const screens: VerifyScreenComparison[] = []
  if (Array.isArray(res.data.screens)) {
    for (let i = 0; i < res.data.screens.length; i++) {
      const rec = asRecord(res.data.screens[i])
      if (!rec) continue
      screens.push({
        id: asString(rec.id)?.trim() || `screen-${i + 1}`,
        title: asString(rec.title)?.trim() || `对比画面 ${i + 1}`,
        expectedLabel: asString(rec.expectedLabel) ?? '批准设计稿 / 预期',
        actualLabel: asString(rec.actualLabel) ?? '实际构建结果',
        expectedHtml: asString(rec.expectedHtml),
        actualHtml: asString(rec.actualHtml),
        diffNote: asString(rec.diffNote),
      })
    }
  }

  const claims: VerifyClaim[] = []
  for (let i = 0; i < rawClaims.length; i++) {
    const rec = asRecord(rawClaims[i])
    if (!rec) return { ok: false, error: `claims[${i}] 必须为对象` }
    const id = asString(rec.id)?.trim() || `claim-${i + 1}`
    const title = asString(rec.title)?.trim()
    if (!title) return { ok: false, error: `claims[${i}] 缺少 title` }
    const rawStatus = asString(rec.status) as VerifyClaimStatus | undefined
    const rawVerdict = asString(rec.verdict) as Verdict | undefined
    claims.push({
      id,
      title,
      status: rawStatus && VALID_CLAIM_STATUS.has(rawStatus) ? rawStatus : 'checked',
      summary: asString(rec.summary),
      command: asString(rec.command),
      evidence: asString(rec.evidence),
      verdict: rawVerdict && VALID_VERDICTS.has(rawVerdict) ? rawVerdict : undefined,
      updatedAt: asString(rec.updatedAt),
    })
  }

  const unverified: VerifyUnverifiedItem[] = []
  if (Array.isArray(res.data.unverified)) {
    for (let i = 0; i < res.data.unverified.length; i++) {
      const rec = asRecord(res.data.unverified[i])
      if (!rec) continue
      const title = asString(rec.title)?.trim()
      if (!title) continue
      const riskRaw = asString(rec.risk)
      unverified.push({
        id: asString(rec.id)?.trim() || `unverified-${i + 1}`,
        title,
        reason: asString(rec.reason) ?? '尚未执行验证',
        risk: riskRaw === 'high' || riskRaw === 'low' ? riskRaw : 'medium',
      })
    }
  }

  const filterRaw = asString(res.data.filterStatus)
  const filterStatus =
    filterRaw === 'all' || (filterRaw && VALID_CLAIM_STATUS.has(filterRaw as VerifyClaimStatus))
      ? (filterRaw as VerifyData['filterStatus'])
      : 'all'

  return {
    ok: true,
    data: {
      title: asString(res.data.title) ?? '交付验收报告',
      summary: asString(res.data.summary),
      showUnverified: asBoolean(res.data.showUnverified) ?? true,
      filterStatus,
      screens,
      claims,
      unverified,
    },
  }
}

/**
 * 把状态流的实时覆盖合入验收数据。
 *
 * @remarks `claimOverrides[<id>]` 更新单条声明的状态、证据、摘要与时间，
 * `verdicts[<id>]` 写入裁决，`props` 覆盖未验证项的展示开关与筛选状态。
 * 类型不合法的覆盖项被忽略；`verdicts` 优先于 `claimOverrides` 里的 `verdict`。
 */
export function applyVerifyState(
  base: VerifyData,
  stateSnapshot: Record<string, unknown> | undefined,
): VerifyData {
  if (!stateSnapshot) return base
  const propsOverlay = asRecord(stateSnapshot.props)
  const claimOverrides = asRecord(stateSnapshot.claimOverrides)
  const verdicts = asRecord(stateSnapshot.verdicts)

  const claims = base.claims.map((c) => {
    const patch = asRecord(claimOverrides?.[c.id])
    const verdictRaw = asString(verdicts?.[c.id]) ?? asString(patch?.verdict)
    const statusRaw = asString(patch?.status) as VerifyClaimStatus | undefined
    return {
      ...c,
      ...(statusRaw && VALID_CLAIM_STATUS.has(statusRaw) ? { status: statusRaw } : {}),
      ...(asString(patch?.evidence) !== undefined ? { evidence: asString(patch?.evidence) } : {}),
      ...(asString(patch?.summary) !== undefined ? { summary: asString(patch?.summary) } : {}),
      ...(asString(patch?.updatedAt) !== undefined
        ? { updatedAt: asString(patch?.updatedAt) }
        : {}),
      ...(verdictRaw && VALID_VERDICTS.has(verdictRaw as Verdict)
        ? { verdict: verdictRaw as Verdict }
        : {}),
    }
  })

  return {
    ...base,
    showUnverified: asBoolean(propsOverlay?.showUnverified) ?? base.showUnverified,
    filterStatus:
      (asString(propsOverlay?.filterStatus) as VerifyData['filterStatus'] | undefined) ??
      base.filterStatus,
    claims,
  }
}

export const VERIFY_TEMPLATE: KitTemplateDefinition<VerifyData> = {
  type: 'verify',
  title: '交付验收报告（Verify）',
  description:
    '预期稿与实际构建并排对比、逐条可展开原始证据声明与未验证项清单，支持 Pass/Reject/Waive 裁决与驳回重验。',
  guide:
    'JSON 格式交付验收报告：包含 claims（id、title、status、command、evidence）、unverified（id、title、reason、risk）与可选 screens（expectedHtml、actualHtml）。被驳回项修复后可通过 state.claimOverrides 更新证据并标为 status="updated" 供重验。',
  example: JSON.stringify(
    {
      title: 'M3 交付验收清单',
      screens: [
        {
          id: 'scr-1',
          title: '主工作台布局对比',
          expectedHtml: '<div class="p-3 border rounded">预期：左右分栏 + 底部提交栏</div>',
          actualHtml:
            '<div class="p-3 border rounded bg-emerald-50">实际：左右分栏 + 底部提交栏</div>',
        },
      ],
      claims: [
        {
          id: 'c-unit',
          title: '全部单元与端到端回归通过',
          status: 'checked',
          command: 'make test',
          evidence: '13 passed (59 tests)',
        },
      ],
      unverified: [
        { id: 'u-prod', title: '生产环境冷启动延迟', reason: '尚未发布至云端', risk: 'low' },
      ],
    },
    null,
    2,
  ),
  propFields: VERIFY_PROP_FIELDS,
  propsSchema: buildPropsJsonSchema(
    ['claims'],
    { claims: { type: 'array' }, unverified: { type: 'array' }, screens: { type: 'array' } },
    VERIFY_PROP_FIELDS,
  ),
  parse: parseVerify,
  validate(source) {
    const parsed = parseVerify(source)
    if (!parsed.ok) {
      return [{ severity: 'error', code: 'INVALID_KIT_SOURCE', message: parsed.error }]
    }
    return [
      ...checkUniqueIds(parsed.data.claims, 'verify.claims'),
      ...checkUniqueIds(parsed.data.screens, 'verify.screens'),
      ...checkUniqueIds(parsed.data.unverified, 'verify.unverified'),
    ]
  },
}
