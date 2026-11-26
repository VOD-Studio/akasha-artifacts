import type { ErrorCode } from '@akasha/protocol'
import { Hono } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { DomainError } from '../../domain/errors.js'
import { authorizeAgentSessionRead, mountDaemonGuard } from './daemon-guard.js'
import type { HttpAppDeps } from './dependencies.js'
import { mountLocalAgentRoutes } from './local-agent.js'
import { parseJsonBody } from './request-body.js'
import { mountArtifactLibraryRoutes } from './routes/artifact-library.js'
import { mountAuthoringRoutes } from './routes/authoring.js'
import { mountBrowserSessionRoutes } from './routes/browser-session.js'
import { mountCodingSessionRoutes } from './routes/coding-sessions.js'
import { mountDaemonRoutes } from './routes/daemon.js'
import { mountDesignSystemRoutes } from './routes/design-systems.js'
import { mountFeedbackRoutes } from './routes/feedback.js'
import { mountProjectRoutes } from './routes/projects.js'
import { mountReviewRoundRoutes } from './routes/rounds.js'
import { mountStateRoutes } from './routes/state.js'
import { mountStorageRoutes } from './routes/storage.js'
import { mountVisualEditRoutes } from './routes/visual-edit.js'

export type { DaemonInfoProvider, HttpAppDeps, HttpSecurityConfig } from './dependencies.js'

// Hub 守卫在转发前自行拒绝的请求不经过这里：例如 INVALID_RECEIPT，守卫回 400，这里映射为 422
function errorCodeToStatus(code: ErrorCode): ContentfulStatusCode {
  switch (code) {
    case 'BAD_REQUEST':
      return 400
    case 'UNAUTHORIZED':
      return 401
    case 'FORBIDDEN':
      return 403
    case 'NOT_FOUND':
      return 404
    case 'VERSION_CONFLICT':
    case 'RESOURCE_CONFLICT':
      return 409
    case 'MATCH_NOT_FOUND':
    case 'AMBIGUOUS_MATCH':
    case 'PATCH_FAILED':
    case 'ROUND_LOCKED':
    case 'INVALID_RECEIPT':
      return 422
    case 'RATE_LIMITED':
      return 429
    default:
      return 500
  }
}

/**
 * Hono HTTP 接口层：只依赖 Web 标准的 `Request` / `Response`，同时适配 Node 本地 Daemon 与
 * Cloudflare Workers。
 *
 * @remarks 传入 `security` 才启用 Host / Origin / Token 校验；领域错误在此统一转为错误信封。
 */
export function createHttpApp(deps: HttpAppDeps): Hono {
  const app = new Hono()
  const { security, agentSessions } = deps
  if (security) mountDaemonGuard(app, security, Boolean(agentSessions))

  app.onError((err, c) => {
    if (err instanceof DomainError) {
      return c.json(
        {
          error: {
            code: err.code,
            message: err.message,
            ...(err.details !== undefined ? { details: err.details } : {}),
          },
        },
        errorCodeToStatus(err.code),
      )
    }
    return c.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: err instanceof Error ? err.message : '服务器内部错误',
        },
      },
      500,
    )
  })

  if (agentSessions && security?.token) {
    const token = security.token
    mountLocalAgentRoutes(app, {
      sessions: agentSessions,
      daemonToken: token,
      checks: deps.checks,
      specs: deps.specs,
      readBody: parseJsonBody,
      authorizeRead: (request) => authorizeAgentSessionRead(request, security, token),
    })
  }

  if (deps.artifactStorage) mountCodingSessionRoutes(app, deps, deps.artifactStorage)
  mountDaemonRoutes(app, deps)
  const forgetSelection = mountProjectRoutes(app, deps)
  mountStorageRoutes(app, deps)
  mountAuthoringRoutes(app, deps)
  mountDesignSystemRoutes(app, deps)
  mountArtifactLibraryRoutes(app, deps, forgetSelection)
  mountVisualEditRoutes(app, deps.service)
  mountStateRoutes(app, deps.service)
  mountReviewRoundRoutes(app, deps.service)
  mountFeedbackRoutes(app, deps)
  mountBrowserSessionRoutes(app, security)

  app.notFound((c) => {
    return c.json(
      { error: { code: 'NOT_FOUND', message: `路由 ${c.req.method} ${c.req.path} 不存在` } },
      404,
    )
  })

  return app
}
