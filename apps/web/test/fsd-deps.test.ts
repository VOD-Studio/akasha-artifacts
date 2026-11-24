import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const guard = fileURLToPath(new URL('../../../scripts/check-deps.mjs', import.meta.url))

function runGuard(sources: Record<string, string>, configFiles: Record<string, string> = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'akasha-fsd-deps-'))
  try {
    const files = {
      'apps/web/package.json': JSON.stringify({ name: '@akasha/web', type: 'module' }),
      ...configFiles,
      ...Object.fromEntries(
        Object.entries(sources).map(([file, content]) => [`apps/web/src/${file}`, content]),
      ),
    }
    for (const [file, content] of Object.entries(files)) {
      const fullPath = path.join(root, file)
      fs.mkdirSync(path.dirname(fullPath), { recursive: true })
      fs.writeFileSync(fullPath, content)
    }
    const result = spawnSync(process.execPath, [guard], { cwd: root, encoding: 'utf8' })
    if (result.error) throw result.error
    return { status: result.status, output: `${result.stdout}${result.stderr}` }
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
}

const aliasConfig = {
  'apps/web/tsconfig.json': JSON.stringify({
    extends: '../../tsconfig.fixture.json',
    compilerOptions: {
      paths: {
        '@/*': ['./src/*'],
        '@library': ['./src/entities/library/index.ts'],
      },
    },
  }),
  'tsconfig.fixture.json': JSON.stringify({
    compilerOptions: {
      module: 'ESNext',
      moduleResolution: 'Bundler',
    },
  }),
}

const library = {
  'entities/library/index.ts': "export type { Item } from './model/item'",
  'entities/library/model/item.ts': 'export type Item = string',
  'entities/library/model/index.ts': "export type { Item } from './item'",
}

describe('Web FSD 依赖门禁', () => {
  it('允许跨层使用根入口、切片内相对引用实现，以及 routes 和 shared 的细粒度入口', () => {
    const result = runGuard(
      {
        ...library,
        'features/pick/index.ts': "export { pick } from './pick'",
        'features/pick/pick.ts': `
          import type { Item } from '@library'
          import type { Item as DirectoryItem } from '@/entities/library'
          export { format as pick } from '../../shared/format/text'
          export type Picked = Item
          export type PickedFromDirectory = DirectoryItem
        `,
        'widgets/picker/index.ts': "export { pick } from '../../features/pick'",
        'routes/library/page.ts': `
          export { pick } from '../../widgets/picker/index.js'
          export * from '../home/page'
          export * from 'react'
        `,
        'routes/home/page.ts': "export { format } from '../../shared/format/text'",
        'shared/format/text.ts': "export { format } from '../strings/format'",
        'shared/strings/format.ts': 'export const format = String',
      },
      aliasConfig,
    )

    expect(result.status, result.output).toBe(0)
    expect(result.output).toContain('依赖方向检查通过')
  })

  it('未解析的相对导入仍会报告向上依赖', () => {
    const result = runGuard({
      'entities/illegal.ts': "import '../features/live-sync/useLiveSync'",
    })

    expect(result.status).toBe(1)
    expect(result.output).toContain(
      'entities/illegal.ts: 违反外壳 FSD 分层 entities → features ("../features/live-sync/useLiveSync")',
    )
  })

  it.each([
    "export * from '../library'",
    "export * as nested from '@/entities/library/model/item'",
  ])('同层不同切片不允许依赖，也不能改用根入口规避：%s', (source) => {
    const result = runGuard(
      {
        ...library,
        'entities/selection/index.ts': source,
      },
      aliasConfig,
    )

    expect(result.status).toBe(1)
    expect(result.output).toContain(
      'entities/selection/index.ts: 禁止外壳 FSD 同层跨切片依赖 entities/selection → entities/library',
    )
    expect(result.output).not.toContain('请从 entities/library/index.ts 导入')
  })

  it.each([
    "import type { Item } from '@/entities/library/model/item'",
    "type Item = import('@/entities/library/model/item').Item",
    "const item = import('@/entities/library/model/item')",
    "const item = require('@/entities/library/model/item')",
    "export * from '@/entities/library/model'",
    "export * from '../../entities/library/model/item'",
    "export * from '../../entities/library/model/missing'",
  ])('禁止跨层绕过切片根入口：%s', (source) => {
    const result = runGuard({ ...library, 'routes/library/page.ts': source }, aliasConfig)

    expect(result.status).toBe(1)
    expect(result.output).toContain(
      'routes/library/page.ts: 违反外壳 FSD 切片入口，请从 entities/library/index.ts 导入',
    )
  })

  it('路径别名不能绕过向上依赖限制', () => {
    const result = runGuard(
      {
        'shared/api/request.ts': "export * from '@/entities/library'",
        ...library,
      },
      aliasConfig,
    )

    expect(result.status).toBe(1)
    expect(result.output).toContain(
      'shared/api/request.ts: 违反外壳 FSD 分层 shared → entities ("@/entities/library")',
    )
  })

  it('切片内部既不能通过自己的根入口回流，也不能用别名引用实现', () => {
    const result = runGuard(
      {
        ...library,
        'entities/library/model/local.ts': `
          export type { Item } from '..'
          export type { Item as AliasedItem } from '@/entities/library/model/item'
        `,
      },
      aliasConfig,
    )

    expect(result.status).toBe(1)
    expect(result.output).toContain(
      'entities/library/model/local.ts: 外壳 FSD 切片内部禁止导入自身根入口 entities/library/index.ts',
    )
    expect(result.output).toContain(
      'entities/library/model/local.ts: 外壳 FSD 切片内部请使用相对路径导入实现',
    )
  })

  it.each(['entities', 'features', 'widgets'])(
    '没有调用方也要求 %s 切片提供根 index.ts',
    (layer) => {
      const result = runGuard({ [`${layer}/library/model/index.ts`]: 'export {}' })

      expect(result.status).toBe(1)
      expect(result.output).toContain(`${layer}/library/index.ts: 外壳 FSD 切片缺少根入口`)
    },
  )
})
