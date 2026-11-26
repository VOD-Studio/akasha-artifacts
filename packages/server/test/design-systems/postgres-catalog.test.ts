import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { expect, it } from 'vitest'
import { createPostgresStorage } from '../../src/infrastructure/storage/postgres/index.js'

const postgresUrl = process.env.AKASHA_TEST_POSTGRES_URL

it.skipIf(!postgresUrl)('PostgreSQL 两个管理员并发切换默认时仍只有一个团队基础', async () => {
  if (!postgresUrl) throw new Error('未配置测试数据库')
  const admin = new Pool({ connectionString: postgresUrl })
  const schema = `akasha_catalog_${randomUUID().replaceAll('-', '')}`
  const url = new URL(postgresUrl)
  url.searchParams.set('options', `-c search_path=${schema}`)
  try {
    await admin.query(`CREATE SCHEMA ${schema}`)
    const a = createPostgresStorage({ connectionString: url.href })
    const b = createPostgresStorage({ connectionString: url.href })
    try {
      await Promise.all([a.ready, b.ready])
      const projectId = 'github-101:identity'
      const now = '2026-11-26T12:00:00.000Z'
      await a.projects.upsert({
        id: projectId,
        rootPath: projectId,
        name: 'Identity',
        lastActiveAt: now,
      })
      const pins = ['catalogBrandOne', 'catalogBrandTwo'].map((id) => ({
        projectId,
        id,
        version: 1,
        generation: 0,
      }))
      for (const pin of pins) {
        await a.artifacts.saveArtifact({
          publicId: pin.id,
          projectId,
          slug: pin.id,
          title: pin.id,
          type: 'design-system',
          visibility: 'private',
          headVersion: 1,
          createdAt: now,
          updatedAt: now,
        })
        await a.artifacts.appendVersion(
          {
            artifactId: pin.id,
            version: 1,
            parentVersion: null,
            title: pin.id,
            source: '{}',
            author: 'human:owner',
            createdAt: now,
          },
          'design-system',
        )
        const members = [{ login: 'brand-manager', userId: '202' }]
        await a.namedSystems.setMembers(pin, members)
        expect(await b.namedSystems.getMembers(pin)).toEqual(members)
        expect(await b.namedSystems.setPublication(pin, 'publish')).toBe(true)
      }
      const [left, right] = pins
      if (!left || !right) throw new Error('缺少并发选用的系统')
      const decisions = await Promise.all([
        a.namedSystems.setPublication(left, 'default'),
        b.namedSystems.setPublication(right, 'default'),
      ])
      expect(decisions).toEqual([true, true])
      const published = await b.namedSystems.listPublications()
      const defaults = published.filter((release) => release.isDefault)
      expect(defaults).toHaveLength(1)
      const active = defaults[0]
      if (!active) throw new Error('并发后缺少默认系统')
      expect(await a.namedSystems.setPublication(active, 'withdraw')).toBe(true)
      expect(await b.namedSystems.publication(active)).toMatchObject({
        withdrawn: true,
        isDefault: false,
      })
      await a.namedSystems.setMembers(left, [])
      expect(await b.namedSystems.listNamed('202')).toEqual([right])
    } finally {
      await Promise.all([a.close(), b.close()])
    }
  } finally {
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`)
    await admin.end()
  }
})
