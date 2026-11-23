import { randomUUID } from 'node:crypto'
import type { Feedback } from '@akasha/protocol'
import { Pool } from 'pg'
import { expect, it } from 'vitest'
import { createPostgresStorage } from '../src/infrastructure/storage/postgres/index.js'

const postgresUrl = process.env.AKASHA_TEST_POSTGRES_URL
const artifactId = 'sandboxAFGHe26rrQ'
const now = '2026-11-23T10:00:00.000Z'

it.skipIf(!postgresUrl)('PostgreSQL 多实例共享有序反馈、回执和制品存储', async () => {
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
