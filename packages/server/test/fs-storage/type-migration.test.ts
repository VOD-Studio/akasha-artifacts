import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createLocalContainer } from '../../src/app/create-local-container.js'
import { startNodeServer } from '../../src/entry/node.js'
import { createFsTestScope } from './fixture.js'

describe('类型迁移与目录交接', () => {
  it('变更 Artifact 类型时清理旧类型目录，避免重启对账把类型回滚回旧目录', async () => {
    const { tempDir, trackClose } = createFsTestScope()
    const projRoot = tempDir('akasha-fs-type-migrate-')
    const artifactsDir = path.join(projRoot, '.artifacts')

    const srv1 = await startNodeServer({
      host: '127.0.0.1',
      port: 0,
      storageMode: 'fs',
      artifactsDir,
      fsProjectId: 'proj_migrate',
    })
    const closeSrv1 = trackClose(srv1.close)

    const pub1 = await srv1.service.publish({
      projectId: 'proj_migrate',
      slug: 'card',
      title: 'Card',
      type: 'react',
      source: 'export default function App() { return <div>v1 react</div> }',
      author: 'agent:cli',
    })
    const oldReactDir = path.join(artifactsDir, 'react', 'card')
    const newHtmlDir = path.join(artifactsDir, 'html', 'card')
    expect(fs.existsSync(path.join(oldReactDir, 'index.tsx'))).toBe(true)

    // 将同一 slug 从 react 变更为 html
    await srv1.service.publish({
      projectId: 'proj_migrate',
      slug: 'card',
      title: 'Card HTML',
      type: 'html',
      source: '<section>v2 html</section>',
      baseVersion: 1,
      author: 'agent:cli',
    })
    expect(fs.existsSync(path.join(newHtmlDir, 'index.html'))).toBe(true)
    expect(fs.readFileSync(path.join(newHtmlDir, 'index.html'), 'utf8')).toBe(
      '<section>v2 html</section>',
    )
    expect(fs.existsSync(oldReactDir)).toBe(false)
    await closeSrv1()

    // 重启对账后必须保持 html 类型与 v2，不得被旧目录回滚成 react
    const srv2 = await startNodeServer({
      host: '127.0.0.1',
      port: 0,
      storageMode: 'fs',
      artifactsDir,
      fsProjectId: 'proj_migrate',
    })
    trackClose(srv2.close)

    const afterRestart = await srv2.service.getArtifact({ id: pub1.artifact.publicId })
    expect(afterRestart.artifact.type).toBe('html')
    expect(afterRestart.artifact.headVersion).toBe(2)
    expect(afterRestart.version.source).toBe('<section>v2 html</section>')
  })

  it('类型迁移命中物理目录碰撞被拒时，不残留孤儿版本且后续合法更新仍可继续推进', async () => {
    const { tempDir, trackClose } = createFsTestScope()
    const projRoot = tempDir('akasha-fs-orphan-rollback-')
    const artifactsDir = path.join(projRoot, '.artifacts')

    const container = createLocalContainer({
      storageMode: 'fs',
      artifactsDir,
      fsProjectId: 'proj_tx',
    })
    trackClose(container.close)
    await container.ready

    const reactCard = await container.service.publish({
      projectId: 'proj_tx',
      slug: 'card',
      title: 'React Card',
      type: 'react',
      source: 'export default function App() { return <div>react v1</div> }',
      author: 'agent:cli',
    })
    await container.service.publish({
      projectId: 'proj_tx',
      slug: 'html/card',
      title: 'HTML Card',
      type: 'html',
      source: '<div>existing html</div>',
      author: 'agent:cli',
    })

    // 尝试将 react 'card' 变更为 html（会与 'html/card' 物理目录碰撞）必须失败
    await expect(
      container.service.publish({
        projectId: 'proj_tx',
        slug: 'card',
        title: 'Collision Attempt',
        type: 'html',
        source: '<div>conflict</div>',
        baseVersion: 1,
        author: 'agent:cli',
      }),
    ).rejects.toThrow(/物理目录 "html\/card" 已被 Artifact/)

    // versions 表中绝不能残留孤儿 v2，后续合法更新到 v2 必须正常成功
    const versionsAfterReject = await container.repositories.artifacts.getVersions(
      reactCard.artifact.publicId,
    )
    expect(versionsAfterReject.map((v) => v.version)).toEqual([1])

    const validV2 = await container.service.publish({
      projectId: 'proj_tx',
      slug: 'card',
      title: 'React Card v2',
      type: 'react',
      source: 'export default function App() { return <div>react v2 ok</div> }',
      baseVersion: 1,
      author: 'agent:cli',
    })
    expect(validV2.artifact.headVersion).toBe(2)
    expect(validV2.version.version).toBe(2)
  })

  it('类型迁移目标目录已存在未入库外部源文件时拒绝迁移覆写，保留外部文件与原版本历史', async () => {
    const { tempDir, trackClose } = createFsTestScope()
    const projRoot = tempDir('akasha-fs-migrate-unindexed-')
    const artifactsDir = path.join(projRoot, '.artifacts')

    const container = createLocalContainer({
      storageMode: 'fs',
      artifactsDir,
      fsProjectId: 'proj_mig_ext',
      fsWatchDebounceMs: 5000,
    })
    trackClose(container.close)
    await container.ready

    const reactCard = await container.service.publish({
      projectId: 'proj_mig_ext',
      slug: 'card',
      title: 'React Card',
      type: 'react',
      source: 'export default function App() { return <div>react v1</div> }',
      author: 'agent:cli',
    })

    // 外部工具在目标 html/card/ 目录新建了尚未入库的文件
    const externalHtmlDir = path.join(artifactsDir, 'html', 'card')
    fs.mkdirSync(externalHtmlDir, { recursive: true })
    const externalHtmlFile = path.join(externalHtmlDir, 'index.html')
    fs.writeFileSync(externalHtmlFile, '<div>external html must survive</div>', 'utf8')

    // 尝试将 react 'card' 迁移为 html 必须被拒绝，绝不静默覆写外部 HTML 文件
    await expect(
      container.service.publish({
        projectId: 'proj_mig_ext',
        slug: 'card',
        title: 'Migrate Card To HTML',
        type: 'html',
        source: '<div>overwrite attempt</div>',
        baseVersion: 1,
        author: 'agent:cli',
      }),
    ).rejects.toThrow(/尚未入库的外部源文件/)

    // 外部 HTML 文件完好无损，原 React Artifact 仍停留在 v1 且无孤儿版本
    expect(fs.readFileSync(externalHtmlFile, 'utf8')).toBe('<div>external html must survive</div>')
    const current = await container.service.getArtifact({ id: reactCard.artifact.publicId })
    expect(current.artifact.type).toBe('react')
    expect(current.artifact.headVersion).toBe(1)
    expect(
      (await container.repositories.artifacts.getVersions(reactCard.artifact.publicId)).map(
        (v) => v.version,
      ),
    ).toEqual([1])
  })
})
