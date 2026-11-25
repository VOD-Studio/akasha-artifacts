import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createLocalContainer } from '../../src/app/create-local-container.js'
import {
  ARTIFACT_ID_FILENAME,
  parseArtifactPathFromFs,
  resolveArtifactFileLayout,
  STATE_DIR_NAME,
} from '../../src/infrastructure/storage/fs/index.js'
import { createFsTestScope } from './fixture.js'

describe('原生文件布局与项目隔离', () => {
  it('按 <type>/<slug>/ 原生文件落盘源码与 .artifact-id，将评论与轮次隔离在 .artifacts/.state/，并拒绝路径穿越', async () => {
    const { tempDir, trackClose } = createFsTestScope()
    const projRoot = tempDir('akasha-fs-proj-')
    const artifactsDir = path.join(projRoot, '.artifacts')

    expect(() => resolveArtifactFileLayout(artifactsDir, 'html', '../escape-me')).toThrow(/非法/)
    expect(() => resolveArtifactFileLayout(artifactsDir, 'html', '.state/hack')).toThrow(/非法/)

    const container = createLocalContainer({
      storageMode: 'fs',
      artifactsDir,
      fsProjectId: 'proj_fs',
      fsWatchDebounceMs: 30,
    })
    trackClose(container.close)

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

    const renamed = await container.service.renameArtifact({
      id: pub.artifact.publicId,
      title: '  新的展示标题  ',
    })
    expect(renamed).toMatchObject({
      publicId: pub.artifact.publicId,
      slug: pub.artifact.slug,
      title: '新的展示标题',
      headVersion: 1,
    })
    const original = await container.service.getArtifact({ id: pub.artifact.publicId, version: 1 })
    expect(original.artifact.title).toBe('新的展示标题')
    expect(original.version).toEqual(pub.version)
    expect(fs.readFileSync(htmlFile, 'utf8')).toBe(pub.version.source)
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

    // parseArtifactPathFromFs 必须忽略 .state/ 内部文件及非规范大小写入口文件名
    expect(
      parseArtifactPathFromFs(artifactsDir, path.join(artifactsDir, STATE_DIR_NAME, 'state.db')),
    ).toBeNull()
    expect(
      parseArtifactPathFromFs(artifactsDir, path.join(artifactsDir, 'html', 'card', 'INDEX.HTML')),
    ).toBeNull()
  })

  it('拒绝跨项目写入同一 .artifacts/ 目录，防止其它项目覆写原生文件与 .artifact-id', async () => {
    const { tempDir, trackClose } = createFsTestScope()
    const projRoot = tempDir('akasha-fs-scope-')
    const artifactsDir = path.join(projRoot, '.artifacts')

    const container = createLocalContainer({
      storageMode: 'fs',
      artifactsDir,
      fsProjectId: 'proj_a',
      fsWatchDebounceMs: 30,
    })
    trackClose(container.close)
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

  it('当 artifactsDir 位于嵌套或外部目录时，按独立 fsProjectRoot 登记所属项目，确保宿主按仓库根目录登记后可正常发布', async () => {
    const { tempDir, trackClose } = createFsTestScope()
    const repoRoot = tempDir('akasha-fs-nested-repo-')
    const nestedArtifactsDir = path.join(repoRoot, '.cache', 'artifacts')

    const container = createLocalContainer({
      storageMode: 'fs',
      artifactsDir: nestedArtifactsDir,
      fsProjectRoot: repoRoot,
    })
    trackClose(container.close)
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
    const { tempDir, trackClose } = createFsTestScope()
    const projRoot = tempDir('akasha-fs-race-')
    const artifactsDir = path.join(projRoot, '.artifacts')

    const container = createLocalContainer({
      storageMode: 'fs',
      artifactsDir,
      fsProjectId: 'proj_race',
    })
    trackClose(container.close)
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
    const { tempDir, trackClose } = createFsTestScope()
    const projRoot = tempDir('akasha-fs-symlink-')
    const outsideDir = tempDir('akasha-fs-outside-')
    const artifactsDir = path.join(projRoot, '.artifacts')

    fs.mkdirSync(path.join(artifactsDir, 'html'), { recursive: true })
    fs.symlinkSync(outsideDir, path.join(artifactsDir, 'html', 'escape-link'), 'dir')

    const container = createLocalContainer({
      storageMode: 'fs',
      artifactsDir,
      fsProjectId: 'proj_sym',
    })
    trackClose(container.close)
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
    const { tempDir, trackClose } = createFsTestScope()
    const projRoot = tempDir('akasha-fs-inside-sym-')
    const artifactsDir = path.join(projRoot, '.artifacts')

    const container = createLocalContainer({
      storageMode: 'fs',
      artifactsDir,
      fsProjectId: 'proj_alias',
    })
    trackClose(container.close)
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
})
