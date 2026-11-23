import { DomainError } from '../../domain/errors.js'

/** 只识别制品项目内 slug 的唯一约束，其他数据库错误不降级为业务冲突。 */
export function rethrowArtifactStoreError(error: unknown): never {
  if (error instanceof Error) {
    const fields = error as Error & { code?: string; constraint?: string; errcode?: number }
    if (
      (fields.code === '23505' && fields.constraint === 'artifacts_project_id_slug_key') ||
      (fields.errcode === 2067 && fields.message.includes('artifacts.project_id, artifacts.slug'))
    ) {
      throw new DomainError('RESOURCE_CONFLICT', '目标项目已存在同名制品，原有内容未更改')
    }
  }
  throw error
}
