import fs from 'node:fs'
import path from 'node:path'
import { startNodeHub } from '@akasha/server/hub'
import { startSandboxServer } from '../daemon/sandbox-server.js'
import { parseHubOrigin } from './login.js'

function envRequired(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`缺少 Cloud Hub 配置 ${name}`)
  return value
}

async function serveCloudHub(): Promise<void> {
  const origin = parseHubOrigin(envRequired('AKASHA_HUB_ORIGIN'))
  const sandboxOrigin = parseHubOrigin(envRequired('AKASHA_SANDBOX_ORIGIN'))
  const shellPort = Number(process.env.AKASHA_HUB_PORT ?? 8080)
  const sandboxPort = Number(process.env.AKASHA_SANDBOX_PORT ?? 8081)
  const webDir = envRequired('AKASHA_WEB_DIR')
  const sandboxDir = envRequired('AKASHA_SANDBOX_DIR')
  fs.accessSync(path.join(sandboxDir, 'index.html'), fs.constants.R_OK)
  const bucket = process.env.AKASHA_S3_BUCKET
  const app = await startNodeHub({
    host: process.env.AKASHA_HUB_HOST ?? '0.0.0.0',
    port: shellPort,
    webDir,
    origin,
    sandboxOrigin,
    dbPath: process.env.AKASHA_SQLITE_PATH ?? '/data/akasha.db',
    connectionString: process.env.DATABASE_URL,
    s3: bucket
      ? {
          bucket,
          region: process.env.AWS_REGION,
          endpoint: process.env.AKASHA_S3_ENDPOINT,
          forcePathStyle: process.env.AKASHA_S3_PATH_STYLE === 'true',
        }
      : undefined,
    oauth: {
      clientId: envRequired('AKASHA_GITHUB_CLIENT_ID'),
      clientSecret: envRequired('AKASHA_GITHUB_CLIENT_SECRET'),
      signingSecret: envRequired('AKASHA_HUB_SIGNING_SECRET'),
      organization: process.env.AKASHA_GITHUB_ORG,
      team: process.env.AKASHA_GITHUB_TEAM,
      allowlist: process.env.AKASHA_GITHUB_ALLOWLIST?.split(',')
        .map((login) => login.trim())
        .filter(Boolean),
    },
  })
  let sandbox: { close: () => Promise<void> }
  try {
    sandbox = await startSandboxServer({
      host: process.env.AKASHA_HUB_HOST ?? '0.0.0.0',
      port: sandboxPort,
      sandboxDir,
      shellOrigins: [origin],
    })
  } catch (error) {
    await app.close()
    throw error
  }
  console.log(`Akasha Cloud Hub: ${origin} · 沙盒 ${sandboxOrigin}`)
  const stop = () => {
    void Promise.all([app.close(), sandbox.close()]).then(
      () => process.exit(0),
      () => process.exit(1),
    )
  }
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
}

void serveCloudHub().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Cloud Hub 启动失败')
  process.exitCode = 1
})
