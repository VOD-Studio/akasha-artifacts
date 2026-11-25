import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createLocalContainer } from '../../src/app/create-local-container.js'
import { createFsTestScope } from './fixture.js'

describe('外部目录移动与身份保持', () => {
  it('目录改名元数据同步即使持过期快照也不会回退并发发布推进后的 headVersion', async () => {
    const { tempDir, trackClose } = createFsTestScope()
    const projRoot = tempDir('akasha-fs-rename-concurrent-')
    const artifactsDir = path.join(projRoot, '.artifacts')

    const container = createLocalContainer({
      storageMode: 'fs',
      artifactsDir,
      fsProjectId: 'proj_conc_rename',
      fsWatchDebounceMs: 30,
    })
    trackClose(container.close)
    await container.ready

    const pub1 = await container.service.publish({
      projectId: 'proj_conc_rename',
      slug: 'html/card',
      title: 'Card',
      type: 'html',
      source: '<div>v1</div>',
      author: 'agent:cli',
    })
    const staleV1Snapshot = { ...pub1.artifact }

    // 模拟并发 API 已成功发布 v2
    await container.service.publish({
      projectId: 'proj_conc_rename',
      slug: 'html/card',
      title: 'Card v2',
      type: 'html',
      source: '<div>v2 from api</div>',
      baseVersion: 1,
      author: 'agent:cli',
    })

    // 即使 updateIndexOnly 收到的是过期 v1 快照，也必须严格保留数据库最新 headVersion=2
    const origDir = path.join(artifactsDir, 'html', 'card')
    const movedDir = path.join(artifactsDir, 'html', 'moved')
    fs.renameSync(origDir, movedDir)
    const updated = await container.fsStorage?.artifacts.updateIndexOnly({
      ...staleV1Snapshot,
      slug: 'html/moved',
      updatedAt: new Date().toISOString(),
    })
    expect(updated?.headVersion).toBe(2)
    expect(updated?.slug).toBe('html/moved')

    // 后续基于 headVersion=2 发布 v3 必须顺利成功，不会因 headVersion 回退触发 versions 主键冲突
    const pub3 = await container.service.publish({
      projectId: 'proj_conc_rename',
      slug: 'html/moved',
      title: 'Card v3',
      type: 'html',
      source: '<div>v3 ok</div>',
      baseVersion: 2,
      author: 'agent:cli',
    })
    expect(pub3.artifact.headVersion).toBe(3)
    expect(fs.readFileSync(path.join(movedDir, 'index.html'), 'utf8')).toBe('<div>v3 ok</div>')
  })

  it('外部移动目录撞上已被短 slug 占用的物理目录时拒绝改名元数据更新，保持两个 Artifact 各自可独立更新', async () => {
    const { tempDir, trackClose } = createFsTestScope()
    const projRoot = tempDir('akasha-fs-move-collision-')
    const artifactsDir = path.join(projRoot, '.artifacts')

    const container = createLocalContainer({
      storageMode: 'fs',
      artifactsDir,
      fsProjectId: 'proj_move_col',
      fsWatchDebounceMs: 30,
    })
    trackClose(container.close)
    await container.ready

    const cardPub = await container.service.publish({
      projectId: 'proj_move_col',
      slug: 'card',
      title: 'Card',
      type: 'html',
      source: '<div>card v1</div>',
      author: 'agent:cli',
    })
    const otherPub = await container.service.publish({
      projectId: 'proj_move_col',
      slug: 'html/other',
      title: 'Other',
      type: 'html',
      source: '<div>other v1</div>',
      author: 'agent:cli',
    })

    // 删除 html/card 后将 html/other 重命名为 html/card：虽 slug 字符串 'html/card' !== 'card'，但物理目录已被 'card' 占用
    const cardDir = path.join(artifactsDir, 'html', 'card')
    const otherDir = path.join(artifactsDir, 'html', 'other')
    fs.rmSync(cardDir, { recursive: true, force: true })
    fs.renameSync(otherDir, cardDir)

    await expect(container.fsWatcher?.syncFile(path.join(cardDir, 'index.html'))).rejects.toThrow(
      /物理目录 "html\/card" 已被 Artifact/,
    )

    // other 仍保留原 slug='html/other'，且两者在清理冲突目录后都可独立正常更新
    const otherState = await container.service.getArtifact({ id: otherPub.artifact.publicId })
    expect(otherState.artifact.slug).toBe('html/other')

    fs.renameSync(cardDir, otherDir)
    const cardV2 = await container.service.publish({
      projectId: 'proj_move_col',
      slug: 'card',
      title: 'Card v2',
      type: 'html',
      source: '<div>card v2 ok</div>',
      baseVersion: 1,
      author: 'agent:cli',
    })
    const otherV2 = await container.service.publish({
      projectId: 'proj_move_col',
      slug: 'html/other',
      title: 'Other v2',
      type: 'html',
      source: '<div>other v2 ok</div>',
      baseVersion: 1,
      author: 'agent:cli',
    })
    expect(cardV2.artifact.publicId).toBe(cardPub.artifact.publicId)
    expect(cardV2.artifact.headVersion).toBe(2)
    expect(otherV2.artifact.headVersion).toBe(2)
  })

  it('外部移动目录目标 slug 已被另一 Artifact 占用时直接拒绝同步，绝不按旧 slug 重建分裂目录', async () => {
    const { tempDir, trackClose } = createFsTestScope()
    const projRoot = tempDir('akasha-fs-move-slug-conflict-')
    const artifactsDir = path.join(projRoot, '.artifacts')

    const container = createLocalContainer({
      storageMode: 'fs',
      artifactsDir,
      fsProjectId: 'proj_slug_col',
      fsWatchDebounceMs: 30,
    })
    trackClose(container.close)
    await container.ready

    const cardPub = await container.service.publish({
      projectId: 'proj_slug_col',
      slug: 'card',
      title: 'Card A',
      type: 'html',
      source: '<div>card A v1</div>',
      author: 'agent:cli',
    })
    // 另一不同类型的 Artifact 占用了 slug='html/moved'
    await container.service.publish({
      projectId: 'proj_slug_col',
      slug: 'html/moved',
      title: 'React B',
      type: 'react',
      source: 'export default function App() { return <div>react B</div> }',
      author: 'agent:cli',
    })

    // 将 A 从 html/card 移至 html/moved 并修改内容：目标 slug 'html/moved' 与 B 冲突，必须直接拒绝且绝不重建 html/card
    const origDir = path.join(artifactsDir, 'html', 'card')
    const movedDir = path.join(artifactsDir, 'html', 'moved')
    fs.renameSync(origDir, movedDir)
    const movedFile = path.join(movedDir, 'index.html')
    fs.writeFileSync(movedFile, '<div>card A edited in conflicting dir</div>', 'utf8')

    await expect(container.fsWatcher?.syncFile(movedFile)).rejects.toThrow(
      /目标 slug "html\/moved" 已被 Artifact/,
    )

    // 绝不能把旧目录 html/card 重建出来，也不能在未解决冲突前推进版本
    expect(fs.existsSync(origDir)).toBe(false)
    const cardState = await container.service.getArtifact({ id: cardPub.artifact.publicId })
    expect(cardState.artifact.slug).toBe('card')
    expect(cardState.artifact.headVersion).toBe(1)
  })

  it('目录改名后在防抖同步前收到旧路径 API 更新时拒绝在旧目录重建同 ID 副本', async () => {
    const { tempDir, trackClose } = createFsTestScope()
    const projRoot = tempDir('akasha-fs-pending-move-')
    const artifactsDir = path.join(projRoot, '.artifacts')

    const container = createLocalContainer({
      storageMode: 'fs',
      artifactsDir,
      fsProjectId: 'proj_pending_move',
      fsWatchDebounceMs: 5000,
    })
    trackClose(container.close)
    await container.ready

    const pub = await container.service.publish({
      projectId: 'proj_pending_move',
      slug: 'card',
      title: 'Card',
      type: 'html',
      source: '<div>v1</div>',
      author: 'agent:cli',
    })

    const origDir = path.join(artifactsDir, 'html', 'card')
    const movedDir = path.join(artifactsDir, 'html', 'moved')
    fs.renameSync(origDir, movedDir)

    // 防抖尚未同步目录改名时，针对旧路径发起 API 更新必须被拒绝，绝不能在 html/card 重建第二份同 ID 目录
    await expect(
      container.service.publish({
        projectId: 'proj_pending_move',
        slug: 'card',
        title: 'Card Stale Path Update',
        type: 'html',
        source: '<div>should not recreate old dir</div>',
        baseVersion: 1,
        author: 'agent:cli',
      }),
    ).rejects.toThrow(/已迁至|拒绝在旧路径重建重复目录/)

    expect(fs.existsSync(origDir)).toBe(false)
    expect(fs.existsSync(path.join(movedDir, 'index.html'))).toBe(true)

    // 监听器同步改名后，基于新 slug 'html/moved' 正常推进 v2 且磁盘仅存单一目录
    await container.fsWatcher?.syncFile(path.join(movedDir, 'index.html'))
    const updated = await container.service.publish({
      projectId: 'proj_pending_move',
      slug: 'html/moved',
      title: 'Card Moved v2',
      type: 'html',
      source: '<div>v2 in moved dir</div>',
      baseVersion: 1,
      author: 'agent:cli',
    })
    expect(updated.artifact.publicId).toBe(pub.artifact.publicId)
    expect(updated.artifact.headVersion).toBe(2)
    expect(fs.existsSync(origDir)).toBe(false)
    expect(fs.readFileSync(path.join(movedDir, 'index.html'), 'utf8')).toBe(
      '<div>v2 in moved dir</div>',
    )
  })

  it('带 .artifact-id 的目录复制不被误判为移动，原目录仍存在时拒绝重复身份劫持', async () => {
    const { tempDir, trackClose } = createFsTestScope()
    const projRoot = tempDir('akasha-fs-copy-dup-id-')
    const artifactsDir = path.join(projRoot, '.artifacts')

    const container = createLocalContainer({
      storageMode: 'fs',
      artifactsDir,
      fsProjectId: 'proj_copy_dup',
      fsWatchDebounceMs: 30,
    })
    trackClose(container.close)
    await container.ready

    const pub = await container.service.publish({
      projectId: 'proj_copy_dup',
      slug: 'html/card',
      title: 'Original Card',
      type: 'html',
      source: '<div>original v1</div>',
      author: 'agent:cli',
    })

    // 完整复制目录（含 .artifact-id）到 html/copied，原目录 html/card 仍存在
    const origDir = path.join(artifactsDir, 'html', 'card')
    const copiedDir = path.join(artifactsDir, 'html', 'copied')
    fs.cpSync(origDir, copiedDir, { recursive: true })
    fs.writeFileSync(path.join(copiedDir, 'index.html'), '<div>copied edit</div>', 'utf8')

    await expect(container.fsWatcher?.syncFile(path.join(copiedDir, 'index.html'))).rejects.toThrow(
      /检测到重复的 \.artifact-id/,
    )

    // 原 Artifact 的 slug 与版本不受复制目录劫持
    const state = await container.service.getArtifact({ id: pub.artifact.publicId })
    expect(state.artifact.slug).toBe('html/card')
    expect(state.artifact.headVersion).toBe(1)
    expect(state.version.source).toBe('<div>original v1</div>')
  })
})
