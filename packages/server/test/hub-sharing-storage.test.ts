import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { Artifact } from '@akasha/protocol'
import { Pool } from 'pg'
import { expect, it } from 'vitest'
import { createMemoryContainer } from '../src/app/create-memory-container.js'
import type { HubGrant, HubSharingRepository } from '../src/domain/hub-sharing.js'
import { createPostgresStorage } from '../src/infrastructure/storage/postgres/index.js'
import { createSqliteHubStorage } from '../src/infrastructure/storage/sqlite/hub-storage.js'

const artifact: Artifact = {
  publicId: 'sharedStorageDesign',
  projectId: 'studio',
  slug: 'design/storage',
  title: '授权存储',
  type: 'html',
  visibility: 'team',
  headVersion: 1,
  createdAt: '2026-11-23T10:00:00.000Z',
  updatedAt: '2026-11-23T10:00:00.000Z',
}
const invitation: HubGrant = {
  artifactId: artifact.publicId,
  id: 'invite-email',
  target: { kind: 'email', email: 'design@example.com' },
  generation: 0,
  subjectId: null,
  acceptedUserId: null,
  role: 'comment',
  entry: { kind: 'artifact' },
  expiresAt: '2026-11-30T10:00:00.000Z',
}
const override = { externalLinks: false, externalEmail: null }
const inherited = { externalLinks: null, externalEmail: null }

const exerciseSharing = async (first: HubSharingRepository, second: HubSharingRepository) => {
  const id = artifact.publicId
  expect(await first.getDefaults()).toEqual({ externalLinks: true, externalEmail: false })
  expect(await second.getScope(id)).toEqual({ restricted: false, override: inherited })
  expect(await second.getScopes([id])).toEqual(new Map())
  await first.setOverride(id, override)
  const link: HubGrant = {
    ...invitation,
    id: 'historic-link',
    target: { kind: 'link' },
    entry: { kind: 'version', version: 1 },
  }
  await second.createGrant(link)
  expect(await first.getGrant(link.id)).toEqual(link)
  expect(await first.acceptGrant(link.id, '101')).toBe(false)
  expect(await first.getScope(id)).toEqual({ restricted: false, override })
  expect(await first.getScopes([id])).toEqual(new Map([[id, { restricted: false, override }]]))
  // 重复 ID 使事务失败，不能留下已停止继承但未发出邀请的半成品。
  await expect(first.createGrant({ ...invitation, id: link.id })).rejects.toThrow()
  expect(await second.getScope(id)).toEqual({ restricted: false, override })

  await first.createGrant(invitation)
  expect(await second.getScope(id)).toEqual({ restricted: true, override })
  expect(await second.getScopes([id, 'elsewhere', id])).toEqual(
    new Map([[id, { restricted: true, override }]]),
  )
  expect(await second.getScopes(['elsewhere'])).toEqual(new Map())
  const accepted = await Promise.all([
    first.acceptGrant(invitation.id, '101'),
    second.acceptGrant(invitation.id, '202'),
  ])
  expect(accepted.filter(Boolean)).toHaveLength(1)
  const winner = accepted[0] ? '101' : '202'
  expect((await second.getGrant(invitation.id))?.acceptedUserId).toBe(winner)
  expect(await second.acceptGrant(invitation.id, winner)).toBe(true)

  expect(await first.changeRole('elsewhere', invitation.id, 'edit')).toBe(false)
  expect(await second.revokeGrant('elsewhere', invitation.id)).toBe(false)
  expect((await second.getGrant(invitation.id))?.role).toBe('comment')
  expect(await first.changeRole(id, invitation.id, 'view')).toBe(true)
  expect((await second.getGrant(invitation.id))?.role).toBe('view')

  const member: HubGrant = {
    ...invitation,
    id: 'invite-member',
    target: { kind: 'member', login: 'designer' },
    subjectId: '303',
    generation: 1,
  }
  await second.createGrant(member)
  expect(await first.acceptGrant(member.id, '404')).toBe(false)
  expect(await first.listGrants(id, 1)).toEqual([member])
  await Promise.all([first.revokeGrant(id, member.id), second.acceptGrant(member.id, '303')])
  expect(await second.getGrant(member.id)).toBeUndefined()
  expect(await first.acceptGrant(member.id, '303')).toBe(false)

  const next = { ...member, id: 'next-generation' }
  await first.createGrant(next)
  await Promise.all([first.restrictToOwner(id), second.acceptGrant(next.id, '303')])
  expect(await second.listGrants(id, 0)).toEqual([])
  expect(await second.listGrants(id, 1)).toEqual([])
  expect(await second.getScope(id)).toEqual({ restricted: true, override })
  await second.setOverride(id, inherited)
  expect(await first.getScope(id)).toEqual({ restricted: true, override: inherited })
  await second.setDefaults({ externalLinks: false, externalEmail: true })
  expect(await first.getDefaults()).toEqual({ externalLinks: false, externalEmail: true })

  await first.saveIdentitySecret('101', 'sealed-1', ['old-key', 'shared-key', 'shared-key'])
  await second.saveIdentitySecret('202', 'sealed-2', ['shared-key'])
  expect((await first.findIdentityByEmailKey('shared-key')).sort()).toEqual(['101', '202'])
  await second.saveIdentitySecret('101', 'sealed-3', ['new-key'])
  expect(await first.getIdentitySecret('101')).toBe('sealed-3')
  expect(await first.findIdentityByEmailKey('old-key')).toEqual([])
  expect(await first.findIdentityByEmailKey('new-key')).toEqual(['101'])
  expect(await first.findIdentityByEmailKey('shared-key')).toEqual(['202'])
  await Promise.all([
    first.saveIdentitySecret('303', 'sealed-left', ['left']),
    second.saveIdentitySecret('303', 'sealed-right', ['right']),
  ])
  const ciphertext = await first.getIdentitySecret('303')
  expect(['sealed-left', 'sealed-right']).toContain(ciphertext)
  expect(await second.findIdentityByEmailKey('left')).toEqual(
    ciphertext === 'sealed-left' ? ['303'] : [],
  )
  expect(await second.findIdentityByEmailKey('right')).toEqual(
    ciphertext === 'sealed-right' ? ['303'] : [],
  )
}

it('内存 Hub 容器使用相同的授权、撤销和身份索引契约', async () => {
  const { artifacts, sharing } = createMemoryContainer().repositories
  await artifacts.saveArtifact(artifact)
  await exerciseSharing(sharing, sharing)
  expect(await artifacts.lifecycle.activeShareGeneration(artifact.publicId)).toBe(1)
})

it('SQLite 两个连接共享授权，关闭重开后仍不继承旧范围且保留密文与邮箱索引', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'akasha-hub-sharing-'))
  const dbPath = path.join(directory, 'hub.sqlite')
  try {
    // 旧版 Hub 的制品没有对应的分享设置行；这里不借用新版本的建表代码。
    const legacy = new DatabaseSync(dbPath)
    try {
      legacy.exec(`CREATE TABLE artifacts (
        public_id TEXT PRIMARY KEY NOT NULL, project_id TEXT NOT NULL, slug TEXT NOT NULL,
        title TEXT NOT NULL, type TEXT NOT NULL, visibility TEXT NOT NULL, head_version INTEGER NOT NULL,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(project_id, slug)
      )`)
      legacy
        .prepare('INSERT INTO artifacts VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(
          artifact.publicId,
          artifact.projectId,
          artifact.slug,
          artifact.title,
          artifact.type,
          artifact.visibility,
          artifact.headVersion,
          artifact.createdAt,
          artifact.updatedAt,
        )
    } finally {
      legacy.close()
    }
    const first = createSqliteHubStorage(dbPath)
    const second = createSqliteHubStorage(dbPath)
    try {
      expect(await first.artifacts.findByPublicId(artifact.publicId)).toEqual(artifact)
      await exerciseSharing(first.sharing, second.sharing)
      expect(await second.artifacts.lifecycle.activeShareGeneration(artifact.publicId)).toBe(1)
      await first.sharing.createGrant({ ...invitation, generation: 1, id: 'after-restriction' })
      expect(await second.sharing.acceptGrant('after-restriction', '101')).toBe(true)
    } finally {
      first.close()
      second.close()
    }
    const reopened = createSqliteHubStorage(dbPath)
    try {
      expect(await reopened.sharing.getScope(artifact.publicId)).toEqual({
        restricted: true,
        override: inherited,
      })
      expect(await reopened.sharing.listGrants(artifact.publicId, 1)).toEqual([
        { ...invitation, generation: 1, id: 'after-restriction', acceptedUserId: '101' },
      ])
      expect(await reopened.sharing.getDefaults()).toEqual({
        externalLinks: false,
        externalEmail: true,
      })
      expect(await reopened.sharing.getIdentitySecret('101')).toBe('sealed-3')
      expect(await reopened.sharing.findIdentityByEmailKey('old-key')).toEqual([])
      expect(await reopened.sharing.findIdentityByEmailKey('new-key')).toEqual(['101'])
    } finally {
      reopened.close()
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

const postgresUrl = process.env.AKASHA_TEST_POSTGRES_URL

it.skipIf(!postgresUrl)('PostgreSQL 两个独立连接池并发接受、撤销及替换身份索引', async () => {
  if (!postgresUrl) throw new Error('未配置测试数据库')
  const server = new Pool({ connectionString: postgresUrl })
  const schema = `akasha_sharing_${randomUUID().replaceAll('-', '')}`
  const url = new URL(postgresUrl)
  url.searchParams.set('options', `-c search_path=${schema}`)
  try {
    await server.query(`CREATE SCHEMA ${schema}`)
    const first = createPostgresStorage({ connectionString: url.href })
    const second = createPostgresStorage({ connectionString: url.href })
    try {
      await first.artifacts.saveArtifact(artifact)
      await exerciseSharing(first.sharing, second.sharing)
      expect(await second.artifacts.lifecycle.activeShareGeneration(artifact.publicId)).toBe(1)
    } finally {
      await Promise.all([first.close(), second.close()])
    }
  } finally {
    try {
      await server.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`)
    } finally {
      await server.end()
    }
  }
})
