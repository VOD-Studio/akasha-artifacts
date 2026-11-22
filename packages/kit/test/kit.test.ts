import { describe, expect, it } from 'vitest'
import {
  applyLiveTimelineState,
  applyVerifyState,
  getKitTemplate,
  listKitTemplates,
  parseArtboard,
  parseDocument,
  parseLiveTimeline,
  parseOptionCompare,
  parseVerify,
  resolveEffectiveProps,
} from '../src/index.js'

describe('@akasha/kit 模板注册表、解析器与静态校验', () => {
  it('默认注册 5 类核心工程与决策模板，且均声明 L2 属性表单字段', () => {
    const types = listKitTemplates()
      .map((t) => t.type)
      .sort()
    expect(types).toEqual(['artboard', 'document', 'live-timeline', 'option-compare', 'verify'])

    for (const tpl of listKitTemplates()) {
      expect(tpl.propFields.length).toBeGreaterThan(0)
      expect(tpl.propsSchema['x-akasha-props']).toBeDefined()
      // 内置 example 必须能通过自身 parse 与 validate 门禁
      expect(tpl.parse(tpl.example).ok).toBe(true)
      expect(tpl.validate(tpl.example).filter((d) => d.severity === 'error')).toHaveLength(0)
    }
  })

  it('live-timeline 支持 StateStream 覆盖 stepOverrides 与 props 实时推进，并拦截重复步骤 ID', () => {
    const tpl = getKitTemplate('live-timeline')
    expect(tpl).toBeDefined()

    const dupDiags = tpl?.validate(
      JSON.stringify({
        steps: [
          { id: 's1', title: '步骤 1', status: 'done' },
          { id: 's1', title: '重复步骤', status: 'pending' },
        ],
      }),
    )
    expect(dupDiags?.some((d) => d.code === 'DUPLICATE_BLOCK_ID')).toBe(true)

    const parsed = parseLiveTimeline(
      JSON.stringify({
        title: '构建流水线',
        steps: [{ id: 's1', title: '测试', status: 'pending' }],
      }),
    )
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return

    const updated = applyLiveTimelineState(parsed.data, {
      props: { title: '发布流水线', showOutputs: false },
      stepOverrides: { s1: { status: 'done', durationMs: 850, output: '59 passed' } },
    })
    expect(updated.title).toBe('发布流水线')
    expect(updated.showOutputs).toBe(false)
    expect(updated.steps[0]?.status).toBe('done')
    expect(updated.steps[0]?.output).toBe('59 passed')
  })

  it('option-compare 与 artboard 校验唯一 ID 与 recommended / flows 引用一致性', () => {
    const optTpl = getKitTemplate('option-compare')
    const optDiags = optTpl?.validate(
      JSON.stringify({
        recommended: 'non-existent',
        options: [{ id: 'a', title: 'A' }],
      }),
    )
    expect(optDiags?.some((d) => d.code === 'UNKNOWN_RECOMMENDED_OPTION')).toBe(true)
    expect(parseOptionCompare(JSON.stringify({ options: [{ id: 'a', title: 'A' }] })).ok).toBe(true)

    const artTpl = getKitTemplate('artboard')
    const artDiags = artTpl?.validate(
      JSON.stringify({
        boards: [{ id: 'b1', title: '方案 1' }],
        flows: [{ from: 'b1', to: 'missing-board', label: '跳转' }],
      }),
    )
    expect(artDiags?.some((d) => d.code === 'UNKNOWN_FLOW_ENDPOINT')).toBe(true)

    const parsedArt = parseArtboard(
      JSON.stringify({
        columns: 10,
        boards: [{ id: 'b1', title: '方案 1' }],
      }),
    )
    expect(parsedArt.ok).toBe(true)
    if (parsedArt.ok) {
      expect(parsedArt.data.columns).toBe(4)
    }
  })

  it('document 同时支持 JSON 结构化块文档与 HTML 双格式并拦截重复块 ID', () => {
    const htmlParsed = parseDocument('<article><h1 id="h1">标题</h1></article>')
    expect(htmlParsed.ok).toBe(true)
    if (htmlParsed.ok) expect(htmlParsed.data.format).toBe('html')

    const docTpl = getKitTemplate('document')
    const dupDoc = docTpl?.validate(
      JSON.stringify({
        title: '设计稿',
        sections: [
          {
            id: 's1',
            heading: '章节',
            paragraphs: [
              { id: 'p1', text: '第一段' },
              { id: 'p1', text: '重复 ID' },
            ],
          },
        ],
      }),
    )
    expect(dupDoc?.some((d) => d.code === 'DUPLICATE_BLOCK_ID')).toBe(true)
  })

  it('verify 支持 StateStream 实时更新驳回重验证据与裁决，并支持 resolveEffectiveProps 合并', () => {
    const parsed = parseVerify(
      JSON.stringify({
        title: '发布验收',
        claims: [{ id: 'c1', title: '单测通过', status: 'failed', evidence: '1 failed' }],
      }),
    )
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return

    const reverified = applyVerifyState(parsed.data, {
      props: { showUnverified: false },
      claimOverrides: {
        c1: { status: 'updated', evidence: '59 passed', updatedAt: '2026-11-22T14:00:00.000Z' },
      },
      verdicts: { c1: 'pass' },
    })
    expect(reverified.showUnverified).toBe(false)
    expect(reverified.claims[0]?.status).toBe('updated')
    expect(reverified.claims[0]?.evidence).toBe('59 passed')
    expect(reverified.claims[0]?.verdict).toBe('pass')

    const merged = resolveEffectiveProps({ columns: 2, showFlows: true }, { props: { columns: 3 } })
    expect(merged).toEqual({ columns: 3, showFlows: true })
  })
})
