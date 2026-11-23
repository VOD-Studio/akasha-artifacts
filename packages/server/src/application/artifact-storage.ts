import {
  ARTIFACT_STORAGE_LIMITS,
  type ArtifactStorageOperation,
  type ArtifactStorageUsage,
  type StorageScope,
} from '@akasha/protocol'
import type { ArtifactStorageRepository } from '../domain/artifact-storage.js'
import { DomainError } from '../domain/errors.js'

const encoder = new TextEncoder()

function namespaceFor(artifactId: string, scope: StorageScope, principal: string | null) {
  return JSON.stringify([artifactId, scope, scope === 'private' ? principal : null])
}

/** 返回当前制品与调用方可用的两个命名空间的序列化用量。 */
export async function getArtifactStorageUsage(
  repository: ArtifactStorageRepository,
  artifactId: string,
  principal: string | null,
): Promise<ArtifactStorageUsage> {
  const [shared, own] = await Promise.all([
    repository.read(namespaceFor(artifactId, 'shared', null)),
    principal ? repository.read(namespaceFor(artifactId, 'private', principal)) : null,
  ])
  return {
    sharedBytes: shared ? encoder.encode(shared.json).length : 0,
    privateBytes: principal ? (own ? encoder.encode(own.json).length : 0) : null,
    limitPerScopeBytes: ARTIFACT_STORAGE_LIMITS.scopeBytes,
  }
}

/**
 * 在仓储上执行一次制品存储操作，读写与配额校验基于同一修订号。
 *
 * @param principal - 调用方的身份，`private` 作用域据此隔离命名空间；`null` 表示未登录。
 * @returns `get` 返回值或 `null`，`list` 返回排序后的键，`set` 与 `delete` 返回是否生效。
 * @throws {DomainError} 未登录访问 `private`（`UNAUTHORIZED`）；键或值超限、超出作用域配额
 * （`BAD_REQUEST`）。
 *
 * @remarks 以 CAS 重试并发冲突，连续 8 次失败抛 `RATE_LIMITED`。
 */
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
  // schema 的 max 按字符计，这里按 UTF-8 字节数复查
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

  // 命名空间由制品、作用域与登录身份共同决定；`shared` 不含身份
  const namespace = namespaceFor(artifactId, operation.scope, principal)
  // CAS 失败说明有并发写入，重读后重试
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
        // 用 defineProperty 而非赋值，避免 `__proto__` 这类键落到原型上
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
