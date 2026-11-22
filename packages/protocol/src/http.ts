import { z } from 'zod'
import { AuthorSchema, ISODateTimeSchema, PublicIdSchema } from './primitives.js'

export const ERROR_CODES = [
  'BAD_REQUEST',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'VERSION_CONFLICT',
  'AMBIGUOUS_MATCH',
  'MATCH_NOT_FOUND',
  'PATCH_FAILED',
  'ROUND_LOCKED',
  'INVALID_RECEIPT',
  'RATE_LIMITED',
  'INTERNAL_ERROR',
] as const

export const ErrorCodeSchema = z.enum(ERROR_CODES)
export type ErrorCode = z.infer<typeof ErrorCodeSchema>

export const VersionConflictDetailsSchema = z.object({
  artifactId: PublicIdSchema,
  baseVersion: z.number().int().min(1),
  headVersion: z.number().int().min(1),
  diff: z.string(),
  authors: z.array(AuthorSchema),
})
export type VersionConflictDetails = z.infer<typeof VersionConflictDetailsSchema>

export const ErrorEnvelopeSchema = z.object({
  error: z.object({
    code: ErrorCodeSchema,
    message: z.string().min(1),
    details: z.unknown().optional(),
  }),
})
export type ErrorEnvelope = z.infer<typeof ErrorEnvelopeSchema>

export const DaemonStatusSchema = z.object({
  status: z.enum(['running', 'stopping']),
  version: z.string().min(1),
  pid: z.number().int().positive(),
  port: z.number().int().min(1).max(65535),
  sandboxPort: z.number().int().min(1).max(65535),
  uptimeSec: z.number().nonnegative(),
  projectCount: z.number().int().nonnegative(),
  activeConnections: z.number().int().nonnegative(),
  relayState: z.enum(['local_only', 'connected', 'degraded', 'rate_limited']),
  startedAt: ISODateTimeSchema,
})
export type DaemonStatus = z.infer<typeof DaemonStatusSchema>

export const HealthResponseSchema = z.object({
  ok: z.literal(true),
  version: z.string().min(1),
})
export type HealthResponse = z.infer<typeof HealthResponseSchema>
