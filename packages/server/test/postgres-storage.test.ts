import { randomUUID } from 'node:crypto'
import type { Artifact, Feedback } from '@akasha/protocol'
import { Pool } from 'pg'
import { expect, it } from 'vitest'
import { createPostgresStorage } from '../src/infrastructure/storage/postgres/index.js'

const postgresUrl = process.env.AKASHA_TEST_POSTGRES_URL
const artifactId = 'sandboxAFGHe26rrQ'
const now = '2026-11-23T10:00:00.000Z'

it.skipIf(!postgresUrl)('PostgreSQL 多实例共享反馈、回执、制品存储与项目索引', async () => {
  if (!postgresUrl) throw new Error('未配置测试数据库')
  const server = new Pool({ connectionString: postgresUrl })
  const schema = `akasha_test_${randomUUID().replaceAll('-', '')}`
  const connectionString = new URL(postgresUrl)
  connectionString.searchParams.set('options', `-c search_path=${schema}`)
  try {
    await server.query(`CREATE SCHEMA ${schema}`)
    const first = createPostgresStorage({ connectionString: connectionString.href })
    const second = createPostgresStorage({ connectionString: connectionString.href })
    try {
      await Promise.all([first.ready, second.ready])
      const projectIds = ['source-a', 'source-b', 'destination']
      await Promise.all(
        projectIds.map((id) =>
          first.projects.upsert({ id, rootPath: `/${id}`, name: id, lastActiveAt: now }),
        ),
      )
      const left: Artifact = {
        publicId: 'pgMoveOriginalA',
        projectId: 'source-a',
        slug: 'html/review',
        title: '移动原件',
        type: 'html',
        visibility: 'private',
        headVersion: 1,
        createdAt: now,
        updatedAt: now,
      }
      const right: Artifact = { ...left, publicId: 'pgMoveOriginalB', projectId: 'source-b' }
      await first.artifacts.saveArtifact(left)
      await second.artifacts.saveArtifact(right)
      const candidates = [left, right]
      const moved = await Promise.allSettled(
        candidates.map((artifact, index) =>
          (index === 0 ? first : second).artifacts.relocate({
            publicId: artifact.publicId,
            sourceProjectId: artifact.projectId,
            targetProjectId: 'destination',
            updatedAt: now,
          }),
        ),
      )
      const winningIndex = moved.findIndex((result) => result.status === 'fulfilled')
      const winner = candidates[winningIndex]
      const loser = candidates[1 - winningIndex]
      if (!winner || !loser) throw new Error('目标索引必须只接纳一个制品')
      expect(moved[1 - winningIndex]).toMatchObject({
        status: 'rejected',
        reason: { code: 'RESOURCE_CONFLICT' },
      })
      // 另一实例已读到旧项目后写入的内容，不会把原件重新放回旧项目。
      await second.artifacts.saveArtifact({ ...winner, headVersion: 2 })
      expect(await first.artifacts.findBySlug('destination', left.slug)).toMatchObject({
        publicId: winner.publicId,
        headVersion: 2,
      })
      expect(await first.artifacts.findBySlug(loser.projectId, loser.slug)).toMatchObject({
        publicId: loser.publicId,
        headVersion: 1,
      })
      expect(await first.artifacts.lifecycle.activeShareGeneration(winner.publicId)).toBe(0)
      expect(await first.artifacts.lifecycle.setWithdrawal(winner.publicId, now)).toBe(true)
      expect(await second.artifacts.findBySlug('destination', winner.slug)).toBeUndefined()
      expect(await second.artifacts.lifecycle.listWithdrawn()).toMatchObject([
        { artifact: { publicId: winner.publicId, projectId: 'destination' }, withdrawnAt: now },
      ])
      expect(await second.artifacts.lifecycle.setWithdrawal(winner.publicId, null)).toBe(true)
      expect(await first.artifacts.lifecycle.activeShareGeneration(winner.publicId)).toBe(1)

      const writes = Array.from({ length: 20 }, (_, index) => {
        const item: Feedback = {
          id: `feedback-${index}`,
          artifactId,
          version: 1,
          roundId: null,
          groupId: null,
          kind: 'comment',
          element: null,
          body: `反馈 ${index}`,
          author: 'human:reviewer',
          draft: false,
          status: 'pending',
          createdAt: now,
          updatedAt: now,
        }
        return (index % 2 === 0 ? first : second).feedbacks.save(item)
      })
      await Promise.all(writes)
      const received = await second.feedbacks.list({ artifactIds: new Set([artifactId]) })
      expect(new Set(received.items.map(({ id }) => id)).size).toBe(20)
      expect(received.cursor).toBe('20')
      const tail = await first.feedbacks.list({ artifactId, afterCursor: '19' })
      expect(tail.items).toEqual(received.items.slice(-1))
      expect(tail.cursor).toBe('20')

      const last = tail.items[0]
      if (!last) throw new Error('缺少待投递反馈')
      const { feedbacks } = first
      await feedbacks.save({
        ...last,
        id: 'human-draft',
        roundId: 'round',
        draft: true,
        audience: 'human',
      })
      await feedbacks.save({
        ...last,
        id: 'agent-draft',
        roundId: 'round',
        draft: true,
        audience: 'agent',
      })
      const preview = await second.feedbacks.list({
        artifactId,
        afterCursor: '20',
        includeDrafts: true,
      })
      expect(preview).toEqual({ items: [], cursor: '20' })
      expect(await feedbacks.promoteRoundDrafts(artifactId, 'round', now)).toBe(2)
      const promoted = await second.feedbacks.list({ artifactId, afterCursor: '20' })
      expect(promoted.items).toMatchObject([{ id: 'agent-draft', draft: false }])
      expect(promoted.cursor).toBe('21')
      expect(await second.feedbacks.findById('human-draft')).toMatchObject({
        draft: false,
        audience: 'human',
      })
      const reply = {
        id: 'reply-1',
        author: 'human:reviewer' as const,
        body: '已核对',
        createdAt: now,
      }
      const resolution = { author: 'human:reviewer' as const, resolvedAt: now }
      await feedbacks.annotations.reply('agent-draft', reply)
      await second.feedbacks.annotations.setResolution('agent-draft', resolution)
      expect(await feedbacks.annotations.list(artifactId, false)).toEqual({
        'agent-draft': { replies: [reply], resolution },
      })
      expect(await feedbacks.list({ artifactId, afterCursor: '21' })).toEqual({
        items: [],
        cursor: '21',
      })

      const receipt = {
        receipt: 'receipt-1',
        artifactId,
        cursor: received.cursor,
        feedbackIds: received.items.map(({ id }) => id),
        issuedAt: now,
      }
      await first.receipts.save(receipt)
      const consumers = await Promise.all([
        first.receipts.consume(receipt.receipt),
        second.receipts.consume(receipt.receipt),
      ])
      expect(consumers.filter(Boolean)).toEqual([receipt])

      const namespace = `${artifactId}:shared`
      const creators = await Promise.all([
        first.artifactStorage.compareAndSet(namespace, 0, '{}'),
        second.artifactStorage.compareAndSet(namespace, 0, '{}'),
      ])
      expect(creators.filter(Boolean)).toHaveLength(1)
      expect(await second.artifactStorage.read(namespace)).toEqual({ revision: 1, json: '{}' })
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
