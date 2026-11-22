import { z } from 'zod'

export const PROTOCOL_VERSION = 1 as const

export const ARTIFACT_TYPES = [
  'react',
  'html',
  'markdown',
  'mermaid',
  'svg',
  'artboard',
  'document',
  'verify',
  'pr-walkthrough',
  'live-timeline',
  'option-compare',
  'data-story',
] as const

export const ArtifactTypeSchema = z.enum(ARTIFACT_TYPES)
export type ArtifactType = z.infer<typeof ArtifactTypeSchema>

export const VisibilitySchema = z.enum(['private', 'team', 'public'])
export type Visibility = z.infer<typeof VisibilitySchema>

// 作者标识约定：agent:<session> 或 human:<user>
export const AuthorSchema = z
  .string()
  .regex(/^(?:agent|human):[A-Za-z0-9._:@-]+$/, '作者格式须为 agent:<id> 或 human:<id>')
export type Author = z.infer<typeof AuthorSchema>

// 对外 URL 使用的不可变公开 ID（默认 21 位字母数字，兼容 16–32 位）
export const PublicIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9]{16,32}$/, 'publicId 须为 16–32 位字母或数字')
export type PublicId = z.infer<typeof PublicIdSchema>

// 项目内可读别名（支持 <type>/<name> 或单段 slug）
export const SlugSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9/_-]{0,127}$/, 'slug 须以小写字母或数字开头，仅含小写字母、数字、/、_、-')
export type Slug = z.infer<typeof SlugSchema>

export const ISODateTimeSchema = z.iso.datetime()
export type ISODateTime = z.infer<typeof ISODateTimeSchema>

// RFC 6901 JSON Pointer：空串代表根，其余每段以 / 开头且 ~ 仅可转义为 ~0 或 ~1
export const JsonPointerSchema = z
  .string()
  .regex(/^(?:\/(?:[^/~]|~[01])*)*$/, 'path 须为合法的 RFC 6901 JSON Pointer')
export type JsonPointer = z.infer<typeof JsonPointerSchema>
