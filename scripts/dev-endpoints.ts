export const devHost = '127.0.0.1'
export const devWorkbenchPort = 5173
export const devSandboxPort = 5174
export const devWorkbenchOrigin = `http://${devHost}:${devWorkbenchPort}`
export const devSandboxOrigin = `http://${devHost}:${devSandboxPort}`
export const devDaemonPort = Number(process.env.AKASHA_DEV_DAEMON_PORT ?? 24321)
export const devDaemonOrigin = `http://${devHost}:${devDaemonPort}`

export const devCacheDir = new URL('../node_modules/.cache/akasha-dev/', import.meta.url)
export const devPublicDir = new URL('public/', devCacheDir)
