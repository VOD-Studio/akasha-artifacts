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
})
