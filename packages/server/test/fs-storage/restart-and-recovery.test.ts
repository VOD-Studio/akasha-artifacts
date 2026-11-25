import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createLocalContainer } from '../../src/app/create-local-container.js'
import { startNodeServer } from '../../src/entry/node.js'
import { ARTIFACT_ID_FILENAME } from '../../src/infrastructure/storage/fs/index.js'
import { createFsTestScope } from './fixture.js'

describe('重启、索引重建与项目恢复', () => {
  it('startNodeServer 启动文件系统模式时自动全量对账既有文件与停机期间的离线修改', async () => {
    const { tempDir, trackClose } = createFsTestScope()
    const projRoot = tempDir('akasha-fs-boot-')
    const artifactsDir = path.join(projRoot, '.artifacts')

    // 1. 首次启动并发布 v1，然后停机
    const srv1 = await startNodeServer({
      host: '127.0.0.1',
      port: 0,
      storageMode: 'fs',
      artifactsDir,
      fsProjectId: 'proj_boot',
    })
    const closeSrv1 = trackClose(srv1.close)
    const pub1 = await srv1.service.publish({
      projectId: 'proj_boot',
      slug: 'html/dashboard',
      title: 'Dashboard',
      type: 'html',
      source: '<h1>v1 before stop</h1>',
      author: 'agent:cli',
    })
    await closeSrv1()

    // 2. 模拟停机期间离线编辑已有文件 + Git checkout 引入全新原生文件
    const existingFile = path.join(artifactsDir, 'html', 'dashboard', 'index.html')
    fs.writeFileSync(existingFile, '<h1>v2 offline edit</h1>', 'utf8')

    const checkoutDir = path.join(artifactsDir, 'markdown', 'release-notes')
    fs.mkdirSync(checkoutDir, { recursive: true })
    fs.writeFileSync(path.join(checkoutDir, 'index.md'), '# Release Notes from Git\n', 'utf8')

    // 3. 重新启动服务（不手动调用 scanAll）：启动完成时应已完成离线修改与新文件的全量对账
    const srv2 = await startNodeServer({
      host: '127.0.0.1',
      port: 0,
      storageMode: 'fs',
      artifactsDir,
      fsProjectId: 'proj_boot',
    })
    trackClose(srv2.close)

    const reconciled = await srv2.service.getArtifact({ id: pub1.artifact.publicId })
    expect(reconciled.artifact.headVersion).toBe(2)
    expect(reconciled.version.source).toBe('<h1>v2 offline edit</h1>')
    expect(reconciled.version.author).toBe('agent:fs')

    // 基于过期 baseVersion=1 的服务端写入必须触发版本冲突，绝不静默覆盖离线改动
    await expect(
      srv2.service.publish({
        projectId: 'proj_boot',
        slug: 'html/dashboard',
        title: 'Dashboard',
        type: 'html',
        source: '<h1>stale overwrite</h1>',
        baseVersion: 1,
        author: 'agent:cli',
      }),
    ).rejects.toThrow(/版本冲突/)

    // 新检出的文件在启动后应立即可查询并已回写 .artifact-id
    const checkoutId = fs.readFileSync(path.join(checkoutDir, ARTIFACT_ID_FILENAME), 'utf8').trim()
    expect(checkoutId.length).toBeGreaterThan(10)
    const discovered = await srv2.service.getArtifact({ id: checkoutId })
    expect(discovered.artifact.type).toBe('markdown')
    expect(discovered.version.source).toContain('Release Notes from Git')
  })

  it('原生源文件离线编辑和重启不重新发布已撤下的制品', async () => {
    const { tempDir, trackClose } = createFsTestScope()
    const root = tempDir('akasha-fs-withdraw-')
    const artifactsDir = path.join(root, '.artifacts')
    const options = { storageMode: 'fs' as const, artifactsDir, fsProjectId: 'proj_withdrawn' }
    const active = createLocalContainer(options)
    const closeActive = trackClose(active.close)
    let publicId: string
    try {
      await active.ready
      const { artifact } = await active.service.publish({
        projectId: options.fsProjectId,
        slug: 'html/source',
        title: '原生撤下',
        type: 'html',
        source: '<h1>保留的初版</h1>',
        author: 'agent:cli',
      })
      publicId = artifact.publicId
      await active.service.setArtifactWithdrawal(publicId, true)
    } finally {
      closeActive()
    }
    const sourcePath = path.join(artifactsDir, 'html', 'source', 'index.html')
    fs.writeFileSync(sourcePath, '<h1>停机期间的编辑</h1>')
    const restarted = createLocalContainer(options)
    trackClose(restarted.close)
    await restarted.ready
    expect(await restarted.repositories.artifacts.listByProject()).toEqual([])
    expect(await restarted.repositories.artifacts.lifecycle.findWithdrawn(publicId)).toMatchObject({
      artifact: { publicId, headVersion: 1 },
    })
    await restarted.service.setArtifactWithdrawal(publicId, false)
    expect((await restarted.service.getArtifact({ id: publicId, version: 1 })).version.source).toBe(
      '<h1>保留的初版</h1>',
    )
    expect(fs.readFileSync(sourcePath, 'utf8')).toBe('<h1>停机期间的编辑</h1>')
  })

  it('重建 .state 索引时保留 Git 中已签入的 .artifact-id 稳定 publicId', async () => {
    const { tempDir, trackClose } = createFsTestScope()
    const projRoot = tempDir('akasha-fs-import-id-')
    const artifactsDir = path.join(projRoot, '.artifacts')

    const checkedInId = 'CheckedInGitId1234567'
    const docDir = path.join(artifactsDir, 'html', 'checked-in')
    fs.mkdirSync(docDir, { recursive: true })
    fs.writeFileSync(path.join(docDir, 'index.html'), '<p>from git repo</p>', 'utf8')
    fs.writeFileSync(path.join(docDir, ARTIFACT_ID_FILENAME), `${checkedInId}\n`, 'utf8')

    // 模拟全新克隆后无 .state/state.db 场景下启动服务
    const srv = await startNodeServer({
      host: '127.0.0.1',
      port: 0,
      storageMode: 'fs',
      artifactsDir,
      fsProjectId: 'proj_git',
    })
    trackClose(srv.close)

    expect(fs.readFileSync(path.join(docDir, ARTIFACT_ID_FILENAME), 'utf8').trim()).toBe(
      checkedInId,
    )
    const imported = await srv.service.getArtifact({ id: checkedInId })
    expect(imported.artifact.publicId).toBe(checkedInId)
    expect(imported.version.source).toBe('<p>from git repo</p>')
  })

  it('兼容外部创建的 react index.jsx 并在服务端更新与重启对账后保持一致，不会回滚', async () => {
    const { tempDir, trackClose } = createFsTestScope()
    const projRoot = tempDir('akasha-fs-jsx-')
    const artifactsDir = path.join(projRoot, '.artifacts')

    const reactDir = path.join(artifactsDir, 'react', 'counter')
    fs.mkdirSync(reactDir, { recursive: true })
    const jsxFile = path.join(reactDir, 'index.jsx')
    fs.writeFileSync(jsxFile, 'export default function App() { return <div>v1 jsx</div> }', 'utf8')

    const srv1 = await startNodeServer({
      host: '127.0.0.1',
      port: 0,
      storageMode: 'fs',
      artifactsDir,
      fsProjectId: 'proj_jsx',
    })
    const closeSrv1 = trackClose(srv1.close)
    const publicId = fs.readFileSync(path.join(reactDir, ARTIFACT_ID_FILENAME), 'utf8').trim()

    // 服务端 API 更新到 v2：应同步写回 index.jsx，不残留过期 jsx 与 tsx 双入口
    await srv1.service.publish({
      projectId: 'proj_jsx',
      slug: 'react/counter',
      title: 'Counter',
      type: 'react',
      source: 'export default function App() { return <div>v2 from api</div> }',
      baseVersion: 1,
      author: 'agent:cli',
    })
    expect(fs.readFileSync(jsxFile, 'utf8')).toContain('v2 from api')
    expect(fs.existsSync(path.join(reactDir, 'index.tsx'))).toBe(false)
    await closeSrv1()

    // 重启并执行全量对账后，必须保持 v2，不得被旧 jsx 覆写回 v1
    const srv2 = await startNodeServer({
      host: '127.0.0.1',
      port: 0,
      storageMode: 'fs',
      artifactsDir,
      fsProjectId: 'proj_jsx',
    })
    trackClose(srv2.close)

    const afterRestart = await srv2.service.getArtifact({ id: publicId })
    expect(afterRestart.artifact.headVersion).toBe(2)
    expect(afterRestart.version.source).toContain('v2 from api')
  })

  it('用户清空已有源文件时在实时同步与重启对账中均能如实记录空版本', async () => {
    const { tempDir, trackClose } = createFsTestScope()
    const projRoot = tempDir('akasha-fs-empty-file-')
    const artifactsDir = path.join(projRoot, '.artifacts')

    const srv1 = await startNodeServer({
      host: '127.0.0.1',
      port: 0,
      storageMode: 'fs',
      artifactsDir,
      fsProjectId: 'proj_empty',
      fsWatchDebounceMs: 20,
    })
    const closeSrv1 = trackClose(srv1.close)

    const pub = await srv1.service.publish({
      projectId: 'proj_empty',
      slug: 'markdown/notes',
      title: 'Notes',
      type: 'markdown',
      source: '# Initial notes',
      author: 'agent:cli',
    })
    const notesFile = path.join(artifactsDir, 'markdown', 'notes', 'index.md')

    // 1. 实时清空文件并通过监听器同步
    fs.writeFileSync(notesFile, '', 'utf8')
    await srv1.fsWatcher?.syncFile(notesFile, { fromWatch: true })
    const afterLiveClear = await srv1.service.getArtifact({ id: pub.artifact.publicId })
    expect(afterLiveClear.artifact.headVersion).toBe(2)
    expect(afterLiveClear.version.source).toBe('')
    await closeSrv1()

    // 2. 停机期间先恢复内容再清空：模拟离线清空并验证重启全量对账记录新空版本
    const srv2 = await startNodeServer({
      host: '127.0.0.1',
      port: 0,
      storageMode: 'fs',
      artifactsDir,
      fsProjectId: 'proj_empty',
    })
    const closeSrv2 = trackClose(srv2.close)
    await srv2.service.publish({
      projectId: 'proj_empty',
      slug: 'markdown/notes',
      title: 'Notes',
      type: 'markdown',
      source: '# Restored before offline clear',
      baseVersion: 2,
      author: 'agent:cli',
    })
    await closeSrv2()

    fs.writeFileSync(notesFile, '', 'utf8')
    const srv3 = await startNodeServer({
      host: '127.0.0.1',
      port: 0,
      storageMode: 'fs',
      artifactsDir,
      fsProjectId: 'proj_empty',
    })
    trackClose(srv3.close)

    const afterOfflineClear = await srv3.service.getArtifact({ id: pub.artifact.publicId })
    expect(afterOfflineClear.artifact.headVersion).toBe(4)
    expect(afterOfflineClear.version.source).toBe('')
    expect(afterOfflineClear.version.author).toBe('agent:fs')
  })

  it('项目目录携 .artifacts/.state 整体改名迁移后，重启刷新项目根路径并保留原 projectId，宿主按新目录登记仍可发布', async () => {
    const { tempDir, trackClose } = createFsTestScope()
    const parent = tempDir('akasha-fs-relocate-')
    const oldRepo = path.join(parent, 'repo-old')
    const newRepo = path.join(parent, 'repo-new')
    fs.mkdirSync(oldRepo, { recursive: true })

    // 1. 在旧目录启动并发布 v1
    const c1 = createLocalContainer({
      storageMode: 'fs',
      artifactsDir: path.join(oldRepo, '.artifacts'),
      fsProjectRoot: oldRepo,
    })
    const closeC1 = trackClose(c1.close)
    await c1.ready
    const origProjectId = c1.fsStorage?.projectId ?? ''
    const pub1 = await c1.service.publish({
      projectId: origProjectId,
      slug: 'html/card',
      title: 'Relocatable Card',
      type: 'html',
      source: '<div>before move</div>',
      author: 'agent:cli',
    })
    closeC1()

    // 2. 将整个仓库目录（含 .artifacts/.state/state.db）迁移到新路径
    fs.renameSync(oldRepo, newRepo)

    // 3. 在新路径重新启动（不显式指定 fsProjectId），应保留原 projectId 并刷新其 root_path
    const c2 = createLocalContainer({
      storageMode: 'fs',
      artifactsDir: path.join(newRepo, '.artifacts'),
      fsProjectRoot: newRepo,
    })
    trackClose(c2.close)
    await c2.ready

    expect(c2.fsStorage?.projectId).toBe(origProjectId)

    // 模拟宿主 MCP 按新仓库路径调用登记（POST /api/v1/projects）
    const registered = await c2.repositories.projects.upsert({
      id: 'proj_new_random',
      rootPath: newRepo,
      name: path.basename(newRepo),
      lastActiveAt: new Date().toISOString(),
    })
    expect(registered.id).toBe(origProjectId)

    // 基于登记返回的 projectId 发布 v2 必须顺利成功，不被 assertOwnedProject 拒绝
    const pub2 = await c2.service.publish({
      projectId: registered.id,
      slug: 'html/card',
      title: 'Relocatable Card v2',
      type: 'html',
      source: '<div>after repo move</div>',
      baseVersion: 1,
      author: 'agent:mcp',
    })
    expect(pub2.artifact.publicId).toBe(pub1.artifact.publicId)
    expect(pub2.artifact.headVersion).toBe(2)
  })
})
