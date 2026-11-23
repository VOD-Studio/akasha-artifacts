import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ARTIFACT_STORAGE_LIMITS } from '@akasha/protocol'
import { expect, it } from 'vitest'
import { createLocalContainer } from '../src/app/create-local-container.js'
import { executeArtifactStorage } from '../src/application/artifact-storage.js'
import { InMemoryArtifactStorage } from '../src/infrastructure/storage/memory/artifact-kv.js'

it('本机制品存储经过 HTTP 鉴权并在 SQLite 重启后保持分域数据', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'akasha-kv-'))
  const dbPath = path.join(directory, 'storage.db')
  const first = createLocalContainer({ dbPath })
  let second: typeof first | undefined
  try {
    const project = await first.service.registerProject({ rootPath: directory, name: '存储测试' })
    const { artifact } = await first.service.publish({
      projectId: project.id,
      slug: 'demo',
      type: 'html',
      title: '存储测试',
      source: '<p>储存</p>',
      author: 'agent:cli',
    })
    const url = `http://127.0.0.1:24321/api/v1/artifacts/${artifact.publicId}/storage`
    const request = (app: typeof first, body: unknown, token = app.token) =>
      app.app.request(url, {
        method: 'POST',
        headers: {
          host: '127.0.0.1:24321',
          origin: 'http://127.0.0.1:24321',
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
      })
    const body = {
      action: 'set',
      scope: 'private',
      key: 'layout:columns',
      value: ['title', 'date'],
    }
    expect((await request(first, body, '')).status).toBe(401)
    expect((await request(first, body)).status).toBe(200)
    expect(
      (await request(first, { ...body, value: 'x'.repeat(ARTIFACT_STORAGE_LIMITS.valueBytes) }))
        .status,
    ).toBe(400)
    first.close()

    second = createLocalContainer({ dbPath })
    const get = { action: 'get', scope: 'private', key: body.key }
    expect(await (await request(second, get)).json()).toEqual({ value: ['title', 'date'] })
    expect(await (await request(second, { ...get, scope: 'shared' })).json()).toEqual({
      value: null,
    })
    expect(
      await (await request(second, { action: 'list', scope: 'private', prefix: 'layout:' })).json(),
    ).toEqual({ value: ['layout:columns'] })
    expect(await (await request(second, { ...get, action: 'delete' })).json()).toEqual({
      value: true,
    })
    expect(await (await request(second, get)).json()).toEqual({ value: null })
  } finally {
    first.close()
    second?.close()
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

it('个人存储按用户隔离，协作存储原子合并并发键', async () => {
  const repository = new InMemoryArtifactStorage()
  const storage = (user: string | null, operation: Parameters<typeof executeArtifactStorage>[3]) =>
    executeArtifactStorage(repository, 'artifact-1', user, operation)
  await storage('1', { action: 'set', scope: 'private', key: 'view', value: 'grid' })
  expect(await storage('2', { action: 'get', scope: 'private', key: 'view' })).toBeNull()
  await expect(storage(null, { action: 'list', scope: 'private' })).rejects.toMatchObject({
    code: 'UNAUTHORIZED',
  })
  await Promise.all([
    storage('1', { action: 'set', scope: 'shared', key: 'north', value: 1 }),
    storage('2', { action: 'set', scope: 'shared', key: 'south', value: 2 }),
  ])
  expect(await storage('2', { action: 'list', scope: 'shared' })).toEqual(['north', 'south'])
})
