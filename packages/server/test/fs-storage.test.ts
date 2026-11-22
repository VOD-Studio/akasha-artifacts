import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { RealtimeServerEvent } from '@akasha/protocol'
import { afterEach, describe, expect, it } from 'vitest'
import { createLocalContainer } from '../src/app/create-local-container.js'
import {
  ARTIFACT_ID_FILENAME,
  parseArtifactPathFromFs,
  resolveArtifactFileLayout,
  STATE_DIR_NAME,
} from '../src/infrastructure/storage/fs/index.js'

const closers: Array<() => void> = []
const tempDirs: string[] = []

afterEach(() => {
  while (closers.length > 0) {
    const close = closers.pop()
    if (close) close()
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
})
