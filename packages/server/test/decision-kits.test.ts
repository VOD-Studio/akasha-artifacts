import { getKitTemplate } from '@akasha/kit'
import { describe, expect, it } from 'vitest'
import { CheckService } from '../src/application/check-service.js'
import { SpecRegistry } from '../src/application/spec-registry.js'

const specs = new SpecRegistry()
const checks = new CheckService(specs)

function walkthrough(diff: string, files = ['cache']) {
  return JSON.stringify({
    chapters: [{ id: 'intro', title: '缓存', files }],
    files: [{ id: 'cache', path: 'src/cache.ts', diff }],
  })
}

function story(value: string | number) {
  return JSON.stringify({
    datasets: [
      {
        id: 'latency',
        title: '延迟',
        columns: [
          { id: 'region', label: '区域', kind: 'text' },
          { id: 'p95', label: 'P95', kind: 'number' },
        ],
        rows: [{ id: 'hz', values: { region: '杭州', p95: value } }],
      },
    ],
    charts: [
      {
        id: 'latency-bar',
        title: '分区延迟',
        datasetId: 'latency',
        category: 'region',
        value: 'p95',
      },
    ],
    tables: [{ id: 'latency-table', title: '延迟明细', datasetId: 'latency', columns: ['p95'] }],
  })
}

describe('决策模板发布门禁', () => {
  it.each(['pr-walkthrough', 'data-story'] as const)(
    '%s 公开同一份模板规范及可发布的示例',
    (type) => {
      const template = getKitTemplate(type)
      const spec = specs.getSpec(type)
      expect(specs.listTypes()).toContain(type)
      expect(spec.guide).toBe(template?.guide)
      expect(spec.schema).toEqual(template?.propsSchema)
      expect(spec.example).toBeTruthy()
      expect(checks.check({ type, source: spec.example ?? '' })).toMatchObject({
        ok: true,
        errors: [],
      })
    },
  )

  it('拒绝无法稳定定位的 diff 和不存在的章节文件引用', () => {
    const type = 'pr-walkthrough'
    expect(checks.check({ type, source: walkthrough('@@ -1 +1 @@\n-old\n+new') }).ok).toBe(true)
    expect(checks.check({ type, source: walkthrough('@@ -1 +1,2 @@\n-old\n+new') }).ok).toBe(false)
    expect(
      checks.check({ type, source: walkthrough('@@ -1 +1 @@\n-old\n+new', ['no-file']) }).ok,
    ).toBe(false)
    expect(
      checks.check({
        type,
        source: walkthrough('@@ -1 +1 @@\n-old\n+new\n@@ -1 +1 @@\n-other\n+again'),
      }).ok,
    ).toBe(false)
  })

  it('拒绝非数字度量，以及不存在的表格列', () => {
    const type = 'data-story'
    expect(checks.check({ type, source: story(145) }).ok).toBe(true)
    expect(checks.check({ type, source: story('145') }).ok).toBe(false)
    expect(checks.check({ type, source: story(145).replace('["p95"]', '["missing"]') }).ok).toBe(
      false,
    )
  })
})
