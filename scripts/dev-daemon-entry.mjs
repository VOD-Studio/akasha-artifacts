import { once } from 'node:events'
import { startAkashaDaemon } from '../packages/akasha/dist/daemon/serve.js'
import { devDaemonPort, devSandboxOrigin, devWorkbenchOrigin } from './dev-endpoints.ts'

const [sessionToken] = await once(process, 'message')
const daemon = await startAkashaDaemon({
  port: devDaemonPort,
  development: {
    workbenchOrigin: devWorkbenchOrigin,
    sandboxOrigin: devSandboxOrigin,
    sessionToken,
  },
})

console.log(`开发 Daemon 已就绪（API：${daemon.baseUrl}）`)
const shutdown = () => void daemon.close()
// 终端与父进程都可能发信号，避免清理到一半被第二个信号终止。
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
process.once('disconnect', shutdown)
// 手动通过 CLI 停止 Daemon 时，不因 IPC 通道还开着而阻止进程退出。
process.channel.unref()
