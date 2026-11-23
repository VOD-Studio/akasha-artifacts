import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from '@aws-sdk/client-s3'
import type { VersionBlobs } from '../cloud/types.js'

export type S3BlobsOptions = Pick<
  S3ClientConfig,
  'region' | 'endpoint' | 'forcePathStyle' | 'credentials'
> & { bucket: string }

/** 版本源码的 S3 兼容对象存储实现。 */
export function createS3Blobs({ bucket, ...config }: S3BlobsOptions): VersionBlobs {
  const client = new S3Client(config)
  return {
    /** 对象不存在时返回 `null`，其余错误原样抛出。 */
    async get(key) {
      try {
        const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
        if (!result.Body) throw new Error(`S3 对象缺少响应体：${key}`)
        return result.Body.transformToString('utf-8')
      } catch (error) {
        if (error instanceof Error && error.name === 'NoSuchKey') return null
        throw error
      }
    },
    async put(key, source) {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: source,
          ContentType: 'text/plain; charset=utf-8',
        }),
      )
    },
  }
}
