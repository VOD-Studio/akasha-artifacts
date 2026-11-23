import { ARTIFACT_STORAGE_LIMITS, type ArtifactStorageOperation } from '@akasha/protocol'
import type { ArtifactStorageRepository } from '../domain/artifact-storage.js'
import { DomainError } from '../domain/errors.js'

const encoder = new TextEncoder()

export async function executeArtifactStorage(
  repository: ArtifactStorageRepository,
  artifactId: string,
  principal: string | null,
  operation: ArtifactStorageOperation,
): Promise<unknown> {
  if (operation.scope === 'private' && !principal) {
    throw new DomainError('UNAUTHORIZED', '登录后才能访问个人制品存储')
  }
  const keyOrPrefix = operation.action === 'list' ? operation.prefix : operation.key
  if (
    keyOrPrefix !== undefined &&
    encoder.encode(keyOrPrefix).length > ARTIFACT_STORAGE_LIMITS.keyBytes
  ) {
    throw new DomainError('BAD_REQUEST', '制品存储键超过字节上限')
  }
  if (operation.action === 'set') {
    let json: string | undefined
    try {
      json = JSON.stringify(operation.value)
    } catch {
      throw new DomainError('BAD_REQUEST', '制品存储值必须是 JSON')
    }
    if (json === undefined || encoder.encode(json).length > ARTIFACT_STORAGE_LIMITS.valueBytes) {
      throw new DomainError('BAD_REQUEST', '制品存储值无效或超过字节上限')
    }
  }

  const namespace = JSON.stringify([
    artifactId,
    operation.scope,
    operation.scope === 'private' ? principal : null,
  ])
  for (let attempt = 0; attempt < 8; attempt++) {
    const current = await repository.read(namespace)
    const entries: Record<string, unknown> = current
      ? JSON.parse(current.json)
      : Object.create(null)
    switch (operation.action) {
      case 'get':
        return Object.hasOwn(entries, operation.key) ? entries[operation.key] : null
      case 'list':
        return Object.keys(entries)
          .filter((name) => name.startsWith(operation.prefix ?? ''))
          .sort()
      case 'delete':
        if (!Object.hasOwn(entries, operation.key)) return false
        delete entries[operation.key]
        break
      case 'set':
        Object.defineProperty(entries, operation.key, {
          value: operation.value,
          enumerable: true,
          writable: true,
          configurable: true,
        })
        break
    }

    const next = JSON.stringify(entries)
    if (
      Object.keys(entries).length > ARTIFACT_STORAGE_LIMITS.entries ||
      encoder.encode(next).length > ARTIFACT_STORAGE_LIMITS.scopeBytes
    ) {
      throw new DomainError('BAD_REQUEST', '制品存储作用域已达到配额，请先删除不需要的键')
    }
    if (await repository.compareAndSet(namespace, current?.revision ?? 0, next)) return true
  }
  throw new DomainError('RATE_LIMITED', '制品存储正在并发更新，请重试')
}
