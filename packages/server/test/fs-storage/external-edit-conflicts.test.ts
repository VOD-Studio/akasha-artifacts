import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createLocalContainer } from '../../src/app/create-local-container.js'
import { startNodeServer } from '../../src/entry/node.js'
import { createFsTestScope } from './fixture.js'

describe('未入库外部编辑的补录与冲突', () => {
  it('防抖窗口内出现未同步的外部磁盘修改时，服务端旧 baseVersion 写入先补录外部版本并抛出 409，绝不静默覆盖', async () => {
    const { tempDir, trackClose } = createFsTestScope()
    const projRoot = tempDir('akasha-fs-debounce-race-')
    const artifactsDir = path.join(projRoot, '.artifacts')

    const container = createLocalContainer({
      storageMode: 'fs',
      artifactsDir,
      fsProjectId: 'proj_debounce',
      // 故意拉长防抖时间，模拟宿主改完文件后、监听器尚未触发前就有 API 写入到达
      fsWatchDebounceMs: 5000,
    })
    trackClose(container.close)
    await container.ready

    const pub = await container.service.publish({
      projectId: 'proj_debounce',
      slug: 'html/card',
      title: 'Card',
      type: 'html',
      source: '<div>v1</div>',
      author: 'agent:cli',
    })
    const cardFile = path.join(artifactsDir, 'html', 'card', 'index.html')

    // 宿主直接改写磁盘，尚未触发防抖同步
    fs.writeFileSync(cardFile, '<div>external host edit before debounce</div>', 'utf8')

    // 服务端旧 baseVersion=1 的 API 写入必须先将磁盘改动补录为 v2 并返回 VERSION_CONFLICT
    await expect(
      container.service.publish({
        projectId: 'proj_debounce',
        slug: 'html/card',
        title: 'Card Stale API',
        type: 'html',
        source: '<div>stale api overwrite</div>',
        baseVersion: 1,
        author: 'agent:cli',
      }),
    ).rejects.toThrow(/版本冲突/)

    // 磁盘保留外部编辑，历史版本完整记录 v2（agent:fs），可随时合并或回退
    expect(fs.readFileSync(cardFile, 'utf8')).toBe('<div>external host edit before debounce</div>')
    const latest = await container.service.getArtifact({ id: pub.artifact.publicId })
    expect(latest.artifact.headVersion).toBe(2)
    expect(latest.version.source).toBe('<div>external host edit before debounce</div>')
    expect(latest.version.author).toBe('agent:fs')
  })

  it('防抖窗口内宿主新建未入库源文件时，API 首次发布先补录外部文件为 v1 并抛出 409，绝不静默覆写', async () => {
    const { tempDir, trackClose } = createFsTestScope()
    const projRoot = tempDir('akasha-fs-unindexed-create-')
    const artifactsDir = path.join(projRoot, '.artifacts')

    const container = createLocalContainer({
      storageMode: 'fs',
      artifactsDir,
      fsProjectId: 'proj_unindexed',
      // 拉长防抖时间，模拟宿主工具刚创建文件、监听器尚未入库时 API 首次发布同名 slug
      fsWatchDebounceMs: 5000,
    })
    trackClose(container.close)
    await container.ready

    const cardDir = path.join(artifactsDir, 'html', 'card')
    fs.mkdirSync(cardDir, { recursive: true })
    const cardFile = path.join(cardDir, 'index.html')
    fs.writeFileSync(cardFile, '<div>created externally by host tool</div>', 'utf8')

    // API 首次发布 slug='card' 必须先将未入库磁盘文件补录为 v1 并以 VERSION_CONFLICT 拒绝覆写
    await expect(
      container.service.publish({
        projectId: 'proj_unindexed',
        slug: 'card',
        title: 'API Card',
        type: 'html',
        source: '<div>api first publish overwrite attempt</div>',
        author: 'agent:cli',
      }),
    ).rejects.toThrow(/版本冲突/)

    // 磁盘原内容完好保留，已自动回写 .artifact-id 并入库为 v1（agent:fs）
    expect(fs.readFileSync(cardFile, 'utf8')).toBe('<div>created externally by host tool</div>')
    const reconciled = await container.service.getArtifact({
      id: 'card',
      projectId: 'proj_unindexed',
    })
    expect(reconciled.artifact.headVersion).toBe(1)
    expect(reconciled.version.source).toBe('<div>created externally by host tool</div>')
    expect(reconciled.version.author).toBe('agent:fs')

    // 随后基于 baseVersion=1 合并发布可正常推进为 v2
    const merged = await container.service.publish({
      projectId: 'proj_unindexed',
      slug: 'card',
      title: 'API Card Merged',
      type: 'html',
      source: '<div>merged v2</div>',
      baseVersion: 1,
      author: 'agent:cli',
    })
    expect(merged.artifact.headVersion).toBe(2)
    expect(fs.readFileSync(cardFile, 'utf8')).toBe('<div>merged v2</div>')
  })

  it('同目录新增未入库的备选规范入口（document index.json / react index.jsx）时，API 更新前先补录为新版本并抛出 409，绝不静默删除', async () => {
    const { tempDir, trackClose } = createFsTestScope()
    const projRoot = tempDir('akasha-fs-alt-entry-')
    const artifactsDir = path.join(projRoot, '.artifacts')

    const container = createLocalContainer({
      storageMode: 'fs',
      artifactsDir,
      fsProjectId: 'proj_alt',
      fsWatchDebounceMs: 5000,
    })
    trackClose(container.close)
    await container.ready

    // 1. document 原本使用 index.html，外部新建 index.json 后立刻有 API 更新到达
    const docPub = await container.service.publish({
      projectId: 'proj_alt',
      slug: 'document/spec',
      title: 'Spec',
      type: 'document',
      source: '<article><h1 id="t">v1 html</h1></article>',
      author: 'agent:cli',
    })
    const docDir = path.join(artifactsDir, 'document', 'spec')
    const externalJson = JSON.stringify({
      title: '外部新建 JSON 文档',
      sections: [{ id: 's1', heading: '章节', paragraphs: [{ id: 'p1', text: '内容' }] }],
    })
    fs.writeFileSync(path.join(docDir, 'index.json'), externalJson, 'utf8')

    await expect(
      container.service.publish({
        projectId: 'proj_alt',
        slug: 'document/spec',
        title: 'Spec API v2',
        type: 'document',
        source: '<article><h1 id="t">api overwrite</h1></article>',
        baseVersion: 1,
        author: 'agent:cli',
      }),
    ).rejects.toThrow(/版本冲突/)

    expect(fs.readFileSync(path.join(docDir, 'index.json'), 'utf8')).toBe(externalJson)
    const docLatest = await container.service.getArtifact({ id: docPub.artifact.publicId })
    expect(docLatest.artifact.headVersion).toBe(2)
    expect(docLatest.version.source).toBe(externalJson)
    expect(docLatest.version.author).toBe('agent:fs')

    // 2. react 原本使用 index.tsx，外部新建 index.jsx 后立刻有 API 更新到达
    const reactPub = await container.service.publish({
      projectId: 'proj_alt',
      slug: 'react/widget',
      title: 'Widget',
      type: 'react',
      source: 'export default function App() { return <div>v1 tsx</div> }',
      author: 'agent:cli',
    })
    const reactDir = path.join(artifactsDir, 'react', 'widget')
    const externalJsx = 'export default function App() { return <div>external jsx</div> }'
    fs.writeFileSync(path.join(reactDir, 'index.jsx'), externalJsx, 'utf8')

    await expect(
      container.service.publish({
        projectId: 'proj_alt',
        slug: 'react/widget',
        title: 'Widget API v2',
        type: 'react',
        source: 'export default function App() { return <div>api tsx overwrite</div> }',
        baseVersion: 1,
        author: 'agent:cli',
      }),
    ).rejects.toThrow(/版本冲突/)

    expect(fs.readFileSync(path.join(reactDir, 'index.jsx'), 'utf8')).toBe(externalJsx)
    const reactLatest = await container.service.getArtifact({ id: reactPub.artifact.publicId })
    expect(reactLatest.artifact.headVersion).toBe(2)
    expect(reactLatest.version.source).toBe(externalJsx)
    expect(reactLatest.version.author).toBe('agent:fs')
  })

  it('启动期首次导入遇到同目录存在内容不同的双规范入口（html+json / tsx+jsx）时拒绝导入且不删除任何未归档文件', async () => {
    const { tempDir, trackClose } = createFsTestScope()
    const projRoot = tempDir('akasha-fs-dual-import-')
    const artifactsDir = path.join(projRoot, '.artifacts')

    // 构造未入库的双入口 document 目录与双入口 react 目录，外加一个正常 html 目录
    const dualDocDir = path.join(artifactsDir, 'document', 'conflict-doc')
    fs.mkdirSync(dualDocDir, { recursive: true })
    fs.writeFileSync(path.join(dualDocDir, 'index.html'), '<article>html copy</article>', 'utf8')
    fs.writeFileSync(
      path.join(dualDocDir, 'index.json'),
      JSON.stringify({ title: 'json copy', sections: [] }),
      'utf8',
    )

    const dualReactDir = path.join(artifactsDir, 'react', 'conflict-react')
    fs.mkdirSync(dualReactDir, { recursive: true })
    fs.writeFileSync(
      path.join(dualReactDir, 'index.tsx'),
      'export default function App() { return <div>tsx</div> }',
      'utf8',
    )
    fs.writeFileSync(
      path.join(dualReactDir, 'index.jsx'),
      'export default function App() { return <div>jsx</div> }',
      'utf8',
    )

    const healthyDir = path.join(artifactsDir, 'html', 'healthy')
    fs.mkdirSync(healthyDir, { recursive: true })
    fs.writeFileSync(path.join(healthyDir, 'index.html'), '<p>healthy</p>', 'utf8')

    const srv = await startNodeServer({
      host: '127.0.0.1',
      port: 0,
      storageMode: 'fs',
      artifactsDir,
      fsProjectId: 'proj_dual',
    })
    trackClose(srv.close)

    // 双入口冲突目录中的四个原始文件必须全部完好保留，绝不可在首次导入时被静默删除
    expect(fs.readFileSync(path.join(dualDocDir, 'index.html'), 'utf8')).toBe(
      '<article>html copy</article>',
    )
    expect(fs.readFileSync(path.join(dualDocDir, 'index.json'), 'utf8')).toContain('json copy')
    expect(fs.readFileSync(path.join(dualReactDir, 'index.tsx'), 'utf8')).toContain('tsx')
    expect(fs.readFileSync(path.join(dualReactDir, 'index.jsx'), 'utf8')).toContain('jsx')

    // 健康目录仍正常导入，双入口冲突目录未被错误建档
    const list = await srv.repositories.artifacts.listByProject('proj_dual')
    expect(list.map((a) => a.slug)).toEqual(['html/healthy'])

    // 清理掉冲突的 index.jsx 后再次扫描，保留的 index.tsx 必须能正常导入且不被失败缓存屏蔽
    fs.rmSync(path.join(dualReactDir, 'index.jsx'))
    const recovered = await srv.fsWatcher?.scanAll()
    expect(recovered).toBeGreaterThanOrEqual(1)
    const afterResolve = await srv.repositories.artifacts.listByProject('proj_dual')
    expect(afterResolve.map((a) => a.slug).sort()).toEqual(['html/healthy', 'react/conflict-react'])
  })

  it('双入口冲突导致外部编辑同步被拒后，删除冲突文件仍可恢复同步为新版本而不被自写缓存屏蔽', async () => {
    const { tempDir, trackClose } = createFsTestScope()
    const projRoot = tempDir('akasha-fs-recover-after-reject-')
    const artifactsDir = path.join(projRoot, '.artifacts')

    const container = createLocalContainer({
      storageMode: 'fs',
      artifactsDir,
      fsProjectId: 'proj_recover',
      fsWatchDebounceMs: 30,
    })
    trackClose(container.close)
    await container.ready

    const pub = await container.service.publish({
      projectId: 'proj_recover',
      slug: 'react/app',
      title: 'App',
      type: 'react',
      source: 'export default function App() { return <div>v1</div> }',
      author: 'agent:cli',
    })

    const appDir = path.join(artifactsDir, 'react', 'app')
    const tsxFile = path.join(appDir, 'index.tsx')
    const jsxFile = path.join(appDir, 'index.jsx')

    // 同时修改 index.tsx 并新建不同内容的 index.jsx → 触发双入口冲突拒绝
    fs.writeFileSync(
      tsxFile,
      'export default function App() { return <div>tsx edit</div> }',
      'utf8',
    )
    fs.writeFileSync(
      jsxFile,
      'export default function App() { return <div>jsx edit</div> }',
      'utf8',
    )
    await expect(container.fsWatcher?.syncFile(tsxFile)).rejects.toThrow(/多个未入库的外部修改/)

    // 删除冲突的 index.jsx 后，保留的 index.tsx 编辑必须能顺利同步为 v2
    fs.rmSync(jsxFile)
    const synced = await container.fsWatcher?.scanAll()
    expect(synced).toBe(1)

    const latest = await container.service.getArtifact({ id: pub.artifact.publicId })
    expect(latest.artifact.headVersion).toBe(2)
    expect(latest.version.source).toContain('tsx edit')
    expect(latest.version.author).toBe('agent:fs')
  })
})
