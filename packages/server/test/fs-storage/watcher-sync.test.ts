import fs from 'node:fs'
import path from 'node:path'
import type { RealtimeServerEvent } from '@akasha/protocol'
import { describe, expect, it } from 'vitest'
import { createLocalContainer } from '../../src/app/create-local-container.js'
import { ARTIFACT_ID_FILENAME } from '../../src/infrastructure/storage/fs/index.js'
import { createFsTestScope } from './fixture.js'

describe('监听器同步与实时通知', () => {
  it('监听宿主外部文件修改自动生成不可变版本并广播 version.created，且支持外部新建与目录重命名保 ID', async () => {
    const { tempDir, trackClose } = createFsTestScope()
    const projRoot = tempDir('akasha-fs-watch-')
    const artifactsDir = path.join(projRoot, '.artifacts')

    const container = createLocalContainer({
      storageMode: 'fs',
      artifactsDir,
      fsProjectId: 'proj_watch',
      fsWatchDebounceMs: 30,
    })
    trackClose(container.close)

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

  it('外部编辑单段 slug（如 card）时保留原 slug 不误判为重命名，并阻止别名 slug 覆写同目录', async () => {
    const { tempDir, trackClose } = createFsTestScope()
    const projRoot = tempDir('akasha-fs-single-slug-')
    const artifactsDir = path.join(projRoot, '.artifacts')

    const container = createLocalContainer({
      storageMode: 'fs',
      artifactsDir,
      fsProjectId: 'proj_slug',
      fsWatchDebounceMs: 30,
    })
    trackClose(container.close)
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

  it('目录改名后再原样移回原路径（内容不变）时，不被自写缓存误屏蔽且索引 slug 正确恢复', async () => {
    const { tempDir, trackClose } = createFsTestScope()
    const projRoot = tempDir('akasha-fs-move-back-')
    const artifactsDir = path.join(projRoot, '.artifacts')

    const container = createLocalContainer({
      storageMode: 'fs',
      artifactsDir,
      fsProjectId: 'proj_moveback',
      fsWatchDebounceMs: 30,
    })
    trackClose(container.close)
    await container.ready

    const pub = await container.service.publish({
      projectId: 'proj_moveback',
      slug: 'html/card',
      title: 'Move Back Card',
      type: 'html',
      source: '<div>unchanged content</div>',
      author: 'agent:cli',
    })

    const origDir = path.join(artifactsDir, 'html', 'card')
    const movedDir = path.join(artifactsDir, 'html', 'moved')

    // 1. 移到 html/moved 并同步（内容未改）
    fs.renameSync(origDir, movedDir)
    await container.fsWatcher?.syncFile(path.join(movedDir, 'index.html'))
    const afterMove = await container.service.getArtifact({ id: pub.artifact.publicId })
    expect(afterMove.artifact.slug).toBe('html/moved')

    // 2. 不修改内容直接移回 html/card，通过 scanAll / syncFile 必须能恢复索引 slug='html/card'
    fs.renameSync(movedDir, origDir)
    await container.fsWatcher?.scanAll()
    const afterMoveBack = await container.service.getArtifact({ id: pub.artifact.publicId })
    expect(afterMoveBack.artifact.slug).toBe('html/card')

    // 3. 随后 API 更新只写入 html/card，绝不重建旧目录 html/moved
    await container.service.publish({
      projectId: 'proj_moveback',
      slug: 'html/card',
      title: 'Move Back Card v2',
      type: 'html',
      source: '<div>updated in restored dir</div>',
      baseVersion: 1,
      author: 'agent:cli',
    })
    expect(fs.readFileSync(path.join(origDir, 'index.html'), 'utf8')).toBe(
      '<div>updated in restored dir</div>',
    )
    expect(fs.existsSync(movedDir)).toBe(false)
  })

  it('外部移动目录改变 Artifact 类型或 slug（源码未变）时主动向在线客户端广播刷新事件', async () => {
    const { tempDir, trackClose } = createFsTestScope()
    const projRoot = tempDir('akasha-fs-move-notify-')
    const artifactsDir = path.join(projRoot, '.artifacts')

    const container = createLocalContainer({
      storageMode: 'fs',
      artifactsDir,
      fsProjectId: 'proj_notify',
      fsWatchDebounceMs: 30,
    })
    trackClose(container.close)
    await container.ready

    const pub = await container.service.publish({
      projectId: 'proj_notify',
      slug: 'html/card',
      title: 'Move Notify Card',
      type: 'html',
      source: '<article><p>same html</p></article>',
      author: 'agent:cli',
    })

    const events: RealtimeServerEvent[] = []
    container.realtime.subscribe({
      projectId: 'proj_notify',
      onEvent: (evt) => events.push(evt),
    })

    // 1. 仅改名（html/card -> html/renamed，源码未变）应广播 version.created 通知前端刷新 slug
    const origDir = path.join(artifactsDir, 'html', 'card')
    const renamedDir = path.join(artifactsDir, 'html', 'renamed')
    fs.renameSync(origDir, renamedDir)
    await container.fsWatcher?.syncFile(path.join(renamedDir, 'index.html'))

    expect(
      events.some((e) => e.type === 'version.created' && e.artifactId === pub.artifact.publicId),
    ).toBe(true)
    const afterRename = await container.service.getArtifact({ id: pub.artifact.publicId })
    expect(afterRename.artifact.slug).toBe('html/renamed')
    expect(afterRename.artifact.headVersion).toBe(1)

    // 2. 跨类型移动（html/renamed -> document/card，源码未变）应生成 v2 并广播 version.created 使前端切换渲染器
    events.length = 0
    const docDir = path.join(artifactsDir, 'document', 'card')
    fs.mkdirSync(path.dirname(docDir), { recursive: true })
    fs.renameSync(renamedDir, docDir)
    await container.fsWatcher?.syncFile(path.join(docDir, 'index.html'))

    const afterTypeMove = await container.service.getArtifact({ id: pub.artifact.publicId })
    expect(afterTypeMove.artifact.type).toBe('document')
    expect(afterTypeMove.artifact.slug).toBe('document/card')
    expect(afterTypeMove.artifact.headVersion).toBe(2)
    expect(
      events.some(
        (e) =>
          e.type === 'version.created' &&
          e.artifactId === pub.artifact.publicId &&
          e.version.version === 2,
      ),
    ).toBe(true)
  })

  it('过时的 agent:fs 监听快照在较新 API 版本已落盘后被拒绝，不会静默回滚最新版本', async () => {
    const { tempDir, trackClose } = createFsTestScope()
    const projRoot = tempDir('akasha-fs-stale-watcher-')
    const artifactsDir = path.join(projRoot, '.artifacts')

    const container = createLocalContainer({
      storageMode: 'fs',
      artifactsDir,
      fsProjectId: 'proj_stale_watch',
      fsWatchDebounceMs: 5000,
    })
    trackClose(container.close)
    await container.ready

    const pub = await container.service.publish({
      projectId: 'proj_stale_watch',
      slug: 'html/card',
      title: 'Card',
      type: 'html',
      source: '<div>v1</div>',
      author: 'agent:cli',
    })
    const cardFile = path.join(artifactsDir, 'html', 'card', 'index.html')

    // 1. 外部编辑产生 v2，并由 API 冲突对账补录为 v2，随后 API 成功合并发布 v3
    fs.writeFileSync(cardFile, '<div>external v2</div>', 'utf8')
    await expect(
      container.service.publish({
        projectId: 'proj_stale_watch',
        slug: 'html/card',
        title: 'Card API stale',
        type: 'html',
        source: '<div>api v2 conflict</div>',
        baseVersion: 1,
        author: 'agent:cli',
      }),
    ).rejects.toThrow(/版本冲突/)

    await container.service.publish({
      projectId: 'proj_stale_watch',
      slug: 'html/card',
      title: 'Card API v3',
      type: 'html',
      source: '<div>api merged v3</div>',
      baseVersion: 2,
      author: 'agent:cli',
    })

    // 2. 模拟迟到的过时监听快照（仍携带旧内容 '<div>external v2</div>'）试图基于 headVersion=3 回写
    await expect(
      container.service.publish({
        projectId: 'proj_stale_watch',
        slug: 'html/card',
        title: 'Card',
        type: 'html',
        source: '<div>external v2</div>',
        baseVersion: 3,
        author: 'agent:fs',
      }),
    ).rejects.toThrow(/快照已过时/)

    // 必须保留 v3，绝不被旧监听快照回滚为 v4
    const latest = await container.service.getArtifact({ id: pub.artifact.publicId })
    expect(latest.artifact.headVersion).toBe(3)
    expect(latest.version.source).toBe('<div>api merged v3</div>')
    expect(fs.readFileSync(cardFile, 'utf8')).toBe('<div>api merged v3</div>')
  })
})
