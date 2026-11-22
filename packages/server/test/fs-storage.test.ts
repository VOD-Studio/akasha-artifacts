import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { RealtimeServerEvent } from '@akasha/protocol'
import { afterEach, describe, expect, it } from 'vitest'
import { createLocalContainer } from '../src/app/create-local-container.js'
import { startNodeServer } from '../src/entry/node.js'
import {
  ARTIFACT_ID_FILENAME,
  parseArtifactPathFromFs,
  resolveArtifactFileLayout,
  STATE_DIR_NAME,
} from '../src/infrastructure/storage/fs/index.js'

const closers: Array<() => void | Promise<void>> = []
const tempDirs: string[] = []

afterEach(async () => {
  while (closers.length > 0) {
    const close = closers.pop()
    if (close) await close()
  }
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) fs.rmSync(dir, { recursive: true, force: true })
  }
})

describe('.artifacts/ 原生文件存储适配器与外部编辑监听', () => {
  it('按 <type>/<slug>/ 原生文件落盘源码与 .artifact-id，将评论与轮次隔离在 .artifacts/.state/，并拒绝路径穿越', async () => {
    const projRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'akasha-fs-proj-'))
    const artifactsDir = path.join(projRoot, '.artifacts')
    tempDirs.push(projRoot)

    expect(() => resolveArtifactFileLayout(artifactsDir, 'html', '../escape-me')).toThrow(/非法/)
    expect(() => resolveArtifactFileLayout(artifactsDir, 'html', '.state/hack')).toThrow(/非法/)

    const container = createLocalContainer({
      storageMode: 'fs',
      artifactsDir,
      fsProjectId: 'proj_fs',
      fsWatchDebounceMs: 30,
    })
    closers.push(container.close)

    // 1. 发布 React 与 HTML Artifact，验证原生文件结构与 .artifact-id
    const pub = await container.service.publish({
      projectId: 'proj_fs',
      slug: 'document/retry-policy',
      title: '重试策略文档',
      type: 'document',
      source: '<article><h1 id="h1">重试策略 v1</h1></article>',
      author: 'agent:cli',
    })

    const docDir = path.join(artifactsDir, 'document', 'retry-policy')
    const htmlFile = path.join(docDir, 'index.html')
    const idFile = path.join(docDir, ARTIFACT_ID_FILENAME)
    expect(fs.existsSync(htmlFile)).toBe(true)
    expect(fs.readFileSync(htmlFile, 'utf8')).toBe(
      '<article><h1 id="h1">重试策略 v1</h1></article>',
    )
    expect(fs.readFileSync(idFile, 'utf8').trim()).toBe(pub.artifact.publicId)

    // 2. document 从 HTML 切换为 JSON 时，旧 index.html 应被清理，仅保留 index.json
    const jsonSource = JSON.stringify({
      title: '重试策略 v2',
      sections: [{ id: 's1', heading: '概览', paragraphs: [{ id: 'p1', text: '超时 3s' }] }],
    })
    await container.service.publish({
      projectId: 'proj_fs',
      slug: 'document/retry-policy',
      title: '重试策略 v2',
      type: 'document',
      source: jsonSource,
      baseVersion: 1,
      author: 'agent:cli',
    })
    expect(fs.existsSync(path.join(docDir, 'index.json'))).toBe(true)
    expect(fs.existsSync(htmlFile)).toBe(false)

    // 3. 评论与评审轮次由服务端独占存于 .artifacts/.state/state.db，不污染源码目录
    await container.service.openRound({
      id: pub.artifact.publicId,
      groups: [{ id: 'g1', title: '确认', kind: 'verify' }],
    })
    await container.service.submitFeedback({
      id: pub.artifact.publicId,
      version: 2,
      kind: 'comment',
      body: '批准通过',
      author: 'human:sun',
    })
    expect(fs.existsSync(path.join(artifactsDir, STATE_DIR_NAME, 'state.db'))).toBe(true)
    expect(fs.readdirSync(docDir).sort()).toEqual([ARTIFACT_ID_FILENAME, 'index.json'])

    // parseArtifactPathFromFs 必须忽略 .state/ 内部文件
    expect(
      parseArtifactPathFromFs(artifactsDir, path.join(artifactsDir, STATE_DIR_NAME, 'state.db')),
    ).toBeNull()
  })

  it('监听宿主外部文件修改自动生成不可变版本并广播 version.created，且支持外部新建与目录重命名保 ID', async () => {
    const projRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'akasha-fs-watch-'))
    const artifactsDir = path.join(projRoot, '.artifacts')
    tempDirs.push(projRoot)

    const container = createLocalContainer({
      storageMode: 'fs',
      artifactsDir,
      fsProjectId: 'proj_watch',
      fsWatchDebounceMs: 30,
    })
    closers.push(container.close)

    const events: RealtimeServerEvent[] = []
    container.realtime.subscribe({
      projectId: 'proj_watch',
      onEvent: (evt) => events.push(evt),
    })

    // 1. 服务端先发布 v1（自写事件不得触发重复 v2 回环）
    const pub1 = await container.service.publish({
      projectId: 'proj_watch',
      slug: 'html/card',
      title: 'Live Card',
      type: 'html',
      source: '<div>v1 from mcp</div>',
      author: 'agent:cli',
    })
    const cardFile = path.join(artifactsDir, 'html', 'card', 'index.html')
    await container.fsWatcher?.syncFile(cardFile)
    const afterOwn = await container.service.getArtifact({ id: pub1.artifact.publicId })
    expect(afterOwn.artifact.headVersion).toBe(1)

    // 2. 模拟宿主原生 Edit/Write 工具直接改写磁盘文件 → 自动生成 v2 并广播 version.created
    fs.writeFileSync(cardFile, '<div>v2 edited by host tool</div>', 'utf8')
    await container.fsWatcher?.syncFile(cardFile)

    const afterExternal = await container.service.getArtifact({ id: pub1.artifact.publicId })
    expect(afterExternal.artifact.headVersion).toBe(2)
    expect(afterExternal.version.source).toBe('<div>v2 edited by host tool</div>')
    expect(afterExternal.version.author).toBe('agent:fs')
    expect(
      events.some(
        (e) =>
          e.type === 'version.created' &&
          e.artifactId === pub1.artifact.publicId &&
          e.version.version === 2,
      ),
    ).toBe(true)

    // 3. 移动/重命名目录并保留 .artifact-id → 稳定 publicId URL 仍可解析且 slug 自动更新
    const renamedDir = path.join(artifactsDir, 'html', 'card-renamed')
    fs.renameSync(path.join(artifactsDir, 'html', 'card'), renamedDir)
    const renamedFile = path.join(renamedDir, 'index.html')
    fs.writeFileSync(renamedFile, '<div>v3 after rename</div>', 'utf8')
    await container.fsWatcher?.syncFile(renamedFile)

    const afterRename = await container.service.getArtifact({ id: pub1.artifact.publicId })
    expect(afterRename.artifact.publicId).toBe(pub1.artifact.publicId)
    expect(afterRename.artifact.slug).toBe('html/card-renamed')
    expect(afterRename.artifact.headVersion).toBe(3)
    expect(afterRename.version.source).toBe('<div>v3 after rename</div>')

    // 4. 宿主工具在 .artifacts/ 内新建全新文件 → scanAll 自动发现、生成 v1 并回写 .artifact-id
    const newDir = path.join(artifactsDir, 'mermaid', 'arch-flow')
    fs.mkdirSync(newDir, { recursive: true })
    const newFile = path.join(newDir, 'diagram.mmd')
    fs.writeFileSync(newFile, 'flowchart LR\n  Host --> FsWatcher --> Browser', 'utf8')

    await container.fsWatcher?.scanAll()
    const discoveredId = fs.readFileSync(path.join(newDir, ARTIFACT_ID_FILENAME), 'utf8').trim()
    expect(discoveredId.length).toBeGreaterThan(10)
    const discovered = await container.service.getArtifact({ id: discoveredId })
    expect(discovered.artifact.type).toBe('mermaid')
    expect(discovered.version.source).toContain('FsWatcher')
  })

  it('拒绝跨项目写入同一 .artifacts/ 目录，防止其它项目覆写原生文件与 .artifact-id', async () => {
    const projRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'akasha-fs-scope-'))
    const artifactsDir = path.join(projRoot, '.artifacts')
    tempDirs.push(projRoot)

    const container = createLocalContainer({
      storageMode: 'fs',
      artifactsDir,
      fsProjectId: 'proj_a',
      fsWatchDebounceMs: 30,
    })
    closers.push(container.close)
    await container.ready

    const pubA = await container.service.publish({
      projectId: 'proj_a',
      slug: 'html/card',
      title: 'Project A Card',
      type: 'html',
      source: '<div>owned by A</div>',
      author: 'agent:a',
    })

    await expect(
      container.service.publish({
        projectId: 'proj_b',
        slug: 'html/card',
        title: 'Project B Card',
        type: 'html',
        source: '<div>hijack from B</div>',
        author: 'agent:b',
      }),
    ).rejects.toThrow(/仅绑定项目 "proj_a"/)

    // A 的源文件、.artifact-id 与 state.db 均保持完好，且 proj_b 未产生任何残留记录
    const cardFile = path.join(artifactsDir, 'html', 'card', 'index.html')
    const idFile = path.join(artifactsDir, 'html', 'card', ARTIFACT_ID_FILENAME)
    expect(fs.readFileSync(cardFile, 'utf8')).toBe('<div>owned by A</div>')
    expect(fs.readFileSync(idFile, 'utf8').trim()).toBe(pubA.artifact.publicId)
    expect(await container.repositories.artifacts.listByProject('proj_b')).toHaveLength(0)
  })

  it('外部编辑单段 slug（如 card）时保留原 slug 不误判为重命名，并阻止别名 slug 覆写同目录', async () => {
    const projRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'akasha-fs-single-slug-'))
    const artifactsDir = path.join(projRoot, '.artifacts')
    tempDirs.push(projRoot)

    const container = createLocalContainer({
      storageMode: 'fs',
      artifactsDir,
      fsProjectId: 'proj_slug',
      fsWatchDebounceMs: 30,
    })
    closers.push(container.close)
    await container.ready

    const pub = await container.service.publish({
      projectId: 'proj_slug',
      slug: 'card',
      title: 'Single Segment Card',
      type: 'html',
      source: '<div>v1</div>',
      author: 'agent:cli',
    })

    const cardFile = path.join(artifactsDir, 'html', 'card', 'index.html')
    expect(fs.existsSync(cardFile)).toBe(true)

    // 1. 外部编辑原目录文件后，slug 必须保持 'card' 而非被改写为 'html/card'
    fs.writeFileSync(cardFile, '<div>v2 external</div>', 'utf8')
    await container.fsWatcher?.syncFile(cardFile)

    const resolvedByShortSlug = await container.service.getArtifact({
      id: 'card',
      projectId: 'proj_slug',
    })
    expect(resolvedByShortSlug.artifact.publicId).toBe(pub.artifact.publicId)
    expect(resolvedByShortSlug.artifact.slug).toBe('card')
    expect(resolvedByShortSlug.artifact.headVersion).toBe(2)
    expect(resolvedByShortSlug.version.source).toBe('<div>v2 external</div>')

    // 2. 再次以 slug='card' 发布应正常推进为 v3，而非新建第二个 Artifact 覆写文件
    const pub3 = await container.service.publish({
      projectId: 'proj_slug',
      slug: 'card',
      title: 'Single Segment Card',
      type: 'html',
      source: '<div>v3 from mcp</div>',
      baseVersion: 2,
      author: 'agent:cli',
    })
    expect(pub3.artifact.publicId).toBe(pub.artifact.publicId)
    expect(pub3.artifact.headVersion).toBe(3)
    expect(await container.repositories.artifacts.listByProject('proj_slug')).toHaveLength(1)

    // 3. 尝试用别名 slug='html/card' 发布到已被 'card' 占用的同一物理目录必须被拒绝
    await expect(
      container.service.publish({
        projectId: 'proj_slug',
        slug: 'html/card',
        title: 'Alias Collision',
        type: 'html',
        source: '<div>collision</div>',
        author: 'agent:cli',
      }),
    ).rejects.toThrow(/物理目录 "html\/card" 已被 Artifact/)
  })

  it('startNodeServer 启动文件系统模式时自动全量对账既有文件与停机期间的离线修改', async () => {
    const projRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'akasha-fs-boot-'))
    const artifactsDir = path.join(projRoot, '.artifacts')
    tempDirs.push(projRoot)

    // 1. 首次启动并发布 v1，然后停机
    const srv1 = await startNodeServer({
      host: '127.0.0.1',
      port: 0,
      storageMode: 'fs',
      artifactsDir,
      fsProjectId: 'proj_boot',
    })
    const pub1 = await srv1.service.publish({
      projectId: 'proj_boot',
      slug: 'html/dashboard',
      title: 'Dashboard',
      type: 'html',
      source: '<h1>v1 before stop</h1>',
      author: 'agent:cli',
    })
    await srv1.close()

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
    closers.push(srv2.close)

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

  it('重建 .state 索引时保留 Git 中已签入的 .artifact-id 稳定 publicId', async () => {
    const projRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'akasha-fs-import-id-'))
    const artifactsDir = path.join(projRoot, '.artifacts')
    tempDirs.push(projRoot)

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
    closers.push(srv.close)

    expect(fs.readFileSync(path.join(docDir, ARTIFACT_ID_FILENAME), 'utf8').trim()).toBe(
      checkedInId,
    )
    const imported = await srv.service.getArtifact({ id: checkedInId })
    expect(imported.artifact.publicId).toBe(checkedInId)
    expect(imported.version.source).toBe('<p>from git repo</p>')
  })

  it('兼容外部创建的 react index.jsx 并在服务端更新与重启对账后保持一致，不会回滚', async () => {
    const projRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'akasha-fs-jsx-'))
    const artifactsDir = path.join(projRoot, '.artifacts')
    tempDirs.push(projRoot)

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
    await srv1.close()

    // 重启并执行全量对账后，必须保持 v2，不得被旧 jsx 覆写回 v1
    const srv2 = await startNodeServer({
      host: '127.0.0.1',
      port: 0,
      storageMode: 'fs',
      artifactsDir,
      fsProjectId: 'proj_jsx',
    })
    closers.push(srv2.close)

    const afterRestart = await srv2.service.getArtifact({ id: publicId })
    expect(afterRestart.artifact.headVersion).toBe(2)
    expect(afterRestart.version.source).toContain('v2 from api')
  })

  it('变更 Artifact 类型时清理旧类型目录，避免重启对账把类型回滚回旧目录', async () => {
    const projRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'akasha-fs-type-migrate-'))
    const artifactsDir = path.join(projRoot, '.artifacts')
    tempDirs.push(projRoot)

    const srv1 = await startNodeServer({
      host: '127.0.0.1',
      port: 0,
      storageMode: 'fs',
      artifactsDir,
      fsProjectId: 'proj_migrate',
    })

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
    await srv1.close()

    // 重启对账后必须保持 html 类型与 v2，不得被旧目录回滚成 react
    const srv2 = await startNodeServer({
      host: '127.0.0.1',
      port: 0,
      storageMode: 'fs',
      artifactsDir,
      fsProjectId: 'proj_migrate',
    })
    closers.push(srv2.close)

    const afterRestart = await srv2.service.getArtifact({ id: pub1.artifact.publicId })
    expect(afterRestart.artifact.type).toBe('html')
    expect(afterRestart.artifact.headVersion).toBe(2)
    expect(afterRestart.version.source).toBe('<section>v2 html</section>')
  })

  it('类型迁移命中物理目录碰撞被拒时，不残留孤儿版本且后续合法更新仍可继续推进', async () => {
    const projRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'akasha-fs-orphan-rollback-'))
    const artifactsDir = path.join(projRoot, '.artifacts')
    tempDirs.push(projRoot)

    const container = createLocalContainer({
      storageMode: 'fs',
      artifactsDir,
      fsProjectId: 'proj_tx',
    })
    closers.push(container.close)
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

  it('当 artifactsDir 位于嵌套或外部目录时，按独立 fsProjectRoot 登记所属项目，确保宿主按仓库根目录登记后可正常发布', async () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'akasha-fs-nested-repo-'))
    const nestedArtifactsDir = path.join(repoRoot, '.cache', 'artifacts')
    tempDirs.push(repoRoot)

    const container = createLocalContainer({
      storageMode: 'fs',
      artifactsDir: nestedArtifactsDir,
      fsProjectRoot: repoRoot,
    })
    closers.push(container.close)
    await container.ready

    // 模拟 MCP 启动时以实际仓库根 repoRoot 调用项目登记（POST /api/v1/projects）
    const registered = await container.repositories.projects.upsert({
      id: 'proj_mcp_generated',
      rootPath: repoRoot,
      name: path.basename(repoRoot),
      lastActiveAt: new Date().toISOString(),
    })

    // 必须命中与 FsArtifactsStorage 绑定的同一 projectId，而非被拆分为新项目导致写入被拒
    expect(registered.id).toBe(container.fsStorage?.projectId)

    const pub = await container.service.publish({
      projectId: registered.id,
      slug: 'html/nested-ok',
      title: 'Nested OK',
      type: 'html',
      source: '<div>works in nested dir</div>',
      author: 'agent:mcp',
    })
    expect(pub.artifact.headVersion).toBe(1)
    expect(fs.existsSync(path.join(nestedArtifactsDir, 'html', 'nested-ok', 'index.html'))).toBe(
      true,
    )
  })

  it('并发首次发布别名 slug（card 与 html/card）时按物理目录互斥，仅允许一个成功且不互相覆写', async () => {
    const projRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'akasha-fs-race-'))
    const artifactsDir = path.join(projRoot, '.artifacts')
    tempDirs.push(projRoot)

    const container = createLocalContainer({
      storageMode: 'fs',
      artifactsDir,
      fsProjectId: 'proj_race',
    })
    closers.push(container.close)
    await container.ready

    const settled = await Promise.allSettled([
      container.service.publish({
        projectId: 'proj_race',
        slug: 'card',
        title: 'Short Card',
        type: 'html',
        source: '<div>from short slug</div>',
        author: 'agent:1',
      }),
      container.service.publish({
        projectId: 'proj_race',
        slug: 'html/card',
        title: 'Prefixed Card',
        type: 'html',
        source: '<div>from prefixed slug</div>',
        author: 'agent:2',
      }),
    ])

    const fulfilled = settled.filter((r) => r.status === 'fulfilled')
    const rejected = settled.filter((r) => r.status === 'rejected')
    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect(String(rejected[0]?.reason)).toMatch(/物理目录 "html\/card" 已被 Artifact/)

    const winner = fulfilled[0]?.value
    expect(winner).toBeDefined()
    const allInDb = await container.repositories.artifacts.listByProject('proj_race')
    expect(allInDb).toHaveLength(1)
    expect(allInDb[0]?.publicId).toBe(winner?.artifact.publicId)
    expect(
      fs.readFileSync(path.join(artifactsDir, 'html', 'card', ARTIFACT_ID_FILENAME), 'utf8').trim(),
    ).toBe(winner?.artifact.publicId)
  })

  it('拒绝通过目录符号链接向 .artifacts 之外越界落盘', async () => {
    const projRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'akasha-fs-symlink-'))
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'akasha-fs-outside-'))
    const artifactsDir = path.join(projRoot, '.artifacts')
    tempDirs.push(projRoot, outsideDir)

    fs.mkdirSync(path.join(artifactsDir, 'html'), { recursive: true })
    fs.symlinkSync(outsideDir, path.join(artifactsDir, 'html', 'escape-link'), 'dir')

    const container = createLocalContainer({
      storageMode: 'fs',
      artifactsDir,
      fsProjectId: 'proj_sym',
    })
    closers.push(container.close)
    await container.ready

    await expect(
      container.service.publish({
        projectId: 'proj_sym',
        slug: 'escape-link',
        title: 'Escape Attempt',
        type: 'html',
        source: '<div>should never escape</div>',
        author: 'agent:cli',
      }),
    ).rejects.toThrow(/符号链接路径|越界/)

    // 外部目录绝不能写入任何文件，state.db 也不应产生记录
    expect(fs.readdirSync(outsideDir)).toEqual([])
    expect(await container.repositories.artifacts.listByProject('proj_sym')).toHaveLength(0)
  })

  it('拒绝 .artifacts 内部目录别名符号链接，防止两个 Artifact 共用同一源码与 .artifact-id', async () => {
    const projRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'akasha-fs-inside-sym-'))
    const artifactsDir = path.join(projRoot, '.artifacts')
    tempDirs.push(projRoot)

    const container = createLocalContainer({
      storageMode: 'fs',
      artifactsDir,
      fsProjectId: 'proj_alias',
    })
    closers.push(container.close)
    await container.ready

    const card = await container.service.publish({
      projectId: 'proj_alias',
      slug: 'card',
      title: 'Original Card',
      type: 'html',
      source: '<div>original card</div>',
      author: 'agent:cli',
    })

    // 在 .artifacts 内部创建指向 html/card 的符号链接别名 html/alias
    fs.symlinkSync(
      path.join(artifactsDir, 'html', 'card'),
      path.join(artifactsDir, 'html', 'alias'),
      'dir',
    )

    await expect(
      container.service.publish({
        projectId: 'proj_alias',
        slug: 'alias',
        title: 'Alias Overwrite',
        type: 'html',
        source: '<div>overwritten via alias</div>',
        author: 'agent:cli',
      }),
    ).rejects.toThrow(/符号链接/)

    // 原 card 的源码与 .artifact-id 必须保持完好
    expect(fs.readFileSync(path.join(artifactsDir, 'html', 'card', 'index.html'), 'utf8')).toBe(
      '<div>original card</div>',
    )
    expect(
      fs.readFileSync(path.join(artifactsDir, 'html', 'card', ARTIFACT_ID_FILENAME), 'utf8').trim(),
    ).toBe(card.artifact.publicId)
  })

  it('用户清空已有源文件时在实时同步与重启对账中均能如实记录空版本', async () => {
    const projRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'akasha-fs-empty-file-'))
    const artifactsDir = path.join(projRoot, '.artifacts')
    tempDirs.push(projRoot)

    const srv1 = await startNodeServer({
      host: '127.0.0.1',
      port: 0,
      storageMode: 'fs',
      artifactsDir,
      fsProjectId: 'proj_empty',
      fsWatchDebounceMs: 20,
    })

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
    await srv1.close()

    // 2. 停机期间先恢复内容再清空：模拟离线清空并验证重启全量对账记录新空版本
    const srv2 = await startNodeServer({
      host: '127.0.0.1',
      port: 0,
      storageMode: 'fs',
      artifactsDir,
      fsProjectId: 'proj_empty',
    })
    await srv2.service.publish({
      projectId: 'proj_empty',
      slug: 'markdown/notes',
      title: 'Notes',
      type: 'markdown',
      source: '# Restored before offline clear',
      baseVersion: 2,
      author: 'agent:cli',
    })
    await srv2.close()

    fs.writeFileSync(notesFile, '', 'utf8')
    const srv3 = await startNodeServer({
      host: '127.0.0.1',
      port: 0,
      storageMode: 'fs',
      artifactsDir,
      fsProjectId: 'proj_empty',
    })
    closers.push(srv3.close)

    const afterOfflineClear = await srv3.service.getArtifact({ id: pub.artifact.publicId })
    expect(afterOfflineClear.artifact.headVersion).toBe(4)
    expect(afterOfflineClear.version.source).toBe('')
    expect(afterOfflineClear.version.author).toBe('agent:fs')
  })
})
